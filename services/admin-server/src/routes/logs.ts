/// /api/logs/:service — Docker Engine API로 컨테이너 로그를 SSE 스트리밍
/// Docker socket(/var/run/docker.sock)에서 HTTP over Unix socket으로 로그를 읽는다.
import type { FastifyInstance } from 'fastify';
import http from 'http';

/** 허용된 서비스명 → Docker 컨테이너명 매핑 */
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT_NAME ?? 'smart-school-cdn-prod';

const SERVICE_CONTAINER_MAP: Record<string, string> = {
  proxy:     `${COMPOSE_PROJECT}-proxy-1`,
  storage:   `${COMPOSE_PROJECT}-storage-service-1`,
  tls:       `${COMPOSE_PROJECT}-tls-service-1`,
  dns:       `${COMPOSE_PROJECT}-dns-service-1`,
  optimizer: `${COMPOSE_PROJECT}-optimizer-service-1`,
  admin:     `${COMPOSE_PROJECT}-admin-server-1`,
};

/** Docker 로그 멀티플렉스 헤더에서 메시지 추출 */
function stripDockerHeader(chunk: Buffer): string {
  const lines: string[] = [];
  let offset = 0;
  while (offset + 8 <= chunk.length) {
    const size = chunk.readUInt32BE(offset + 4);
    if (offset + 8 + size > chunk.length) break;
    const payload = chunk.slice(offset + 8, offset + 8 + size).toString('utf8');
    lines.push(payload);
    offset += 8 + size;
  }
  // 헤더 파싱 실패 시 raw 텍스트로 폴백
  return lines.length > 0 ? lines.join('') : chunk.toString('utf8');
}

/** ANSI 이스케이프 시퀀스 제거 — Rust tracing_subscriber color 출력 처리 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Rust tracing / pino 로그 라인 파싱
 *
 * Docker API timestamps=1 옵션 활성화 시 실제 로그 형식:
 *   <docker_ts> [ANSI]<rust_ts>[ANSI] [ANSI]LEVEL[ANSI] [ANSI]target[ANSI]: message
 *
 * 예: "2026-04-26T12:45:11.701717732Z [2m2026-04-26T12:45:11.701563Z[0m [33m WARN[0m ..."
 *
 * 전략:
 *  1. ANSI 코드를 제거하여 파싱 가능한 텍스트로 변환
 *  2. 첫 번째 타임스탬프(Docker 타임스탬프)를 기준으로 파싱 — 항상 깨끗한 ISO 8601 형식
 *  3. Docker 타임스탬프 뒤에 두 번째 타임스탬프(Rust tracing)가 있을 수 있으므로 선택적으로 처리
 */
function parseLine(raw: string, service: string): LogLine | null {
  const line = raw.trim();
  if (!line) return null;

  // ANSI 이스케이프 코드 제거
  const clean = line.replace(ANSI_RE, '').trim();

  // Docker timestamps=1 + Rust tracing 형식:
  //   "<docker_ts> <rust_ts> LEVEL target: message"  (두 타임스탬프 모두 있는 경우)
  //   "<docker_ts> LEVEL target: message"            (단일 타임스탬프)
  // Docker 타임스탬프를 사용하되, Rust tracing 타임스탬프가 있으면 건너뜀
  const dockerPlusRustMatch = clean.match(
    /^(\d{4}-\d{2}-\d{2}T[\d:.Z]+)\s+\d{4}-\d{2}-\d{2}T[\d:.Z]+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(.+)$/
  );
  if (dockerPlusRustMatch) {
    return {
      timestamp: dockerPlusRustMatch[1],
      level: dockerPlusRustMatch[2] as LogLine['level'],
      message: dockerPlusRustMatch[3],
      service,
    };
  }

  // 단일 타임스탬프 형식: "<ts> LEVEL target: message"
  const singleMatch = clean.match(
    /^(\d{4}-\d{2}-\d{2}T[\d:.Z]+)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(.+)$/
  );
  if (singleMatch) {
    return {
      timestamp: singleMatch[1],
      level: singleMatch[2] as LogLine['level'],
      message: singleMatch[3],
      service,
    };
  }

  // 기타 형식: level 추측, ANSI 제거된 텍스트 사용
  const level: LogLine['level'] =
    /error/i.test(clean) ? 'ERROR' :
    /warn/i.test(clean)  ? 'WARN'  :
    /debug/i.test(clean) ? 'DEBUG' : 'INFO';

  return { timestamp: new Date().toISOString(), level, message: clean, service };
}

export interface LogLine {
  timestamp: string;
  level: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  service: string;
}

export async function logRoutes(app: FastifyInstance) {
  app.get<{
    Params: { service: string };
    Querystring: { tail?: string; follow?: string };
  }>('/api/logs/:service', async (request, reply) => {
    const { service } = request.params;
    const containerName = SERVICE_CONTAINER_MAP[service];

    if (!containerName) {
      return reply.status(400).send({ error: '허용되지 않은 서비스입니다.' });
    }

    const tailRaw = parseInt(request.query.tail ?? '100', 10);
    const tail = Math.min(isNaN(tailRaw) ? 100 : Math.max(1, tailRaw), 500);
    const follow = request.query.follow !== 'false';
    const dockerSocket = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';

    const path =
      `/containers/${encodeURIComponent(containerName)}/logs` +
      `?stdout=1&stderr=1&timestamps=1&tail=${tail}${follow ? '&follow=1' : ''}`;

    return new Promise<void>((resolve) => {
      const req = http.request(
        { socketPath: dockerSocket, path, method: 'GET' },
        (dockerRes) => {
          if (follow) {
            // SSE 모드 — 스트리밍
            reply.raw.writeHead(200, {
              'Content-Type':  'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection':    'keep-alive',
              'X-Accel-Buffering': 'no',
            });

            let buf = Buffer.alloc(0);
            dockerRes.on('data', (chunk: Buffer) => {
              if (closed) return;
              buf = Buffer.concat([buf, chunk]);
              // 헤더+페이로드 단위로 처리
              let offset = 0;
              while (offset + 8 <= buf.length) {
                const size = buf.readUInt32BE(offset + 4);
                if (offset + 8 + size > buf.length) break;
                const payload = buf
                  .slice(offset + 8, offset + 8 + size)
                  .toString('utf8');
                offset += 8 + size;

                for (const raw of payload.split('\n')) {
                  const line = parseLine(raw, service);
                  if (line) {
                    reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
                  }
                }
              }
              buf = buf.slice(offset);
            });

            // 중복 종료 방지 플래그 — resolve/end는 한 번만
            let closed = false;

            dockerRes.on('end', () => {
              if (closed) return;
              closed = true;
              reply.raw.end();
              resolve();
            });

            dockerRes.on('error', () => {
              if (closed) return;
              closed = true;
              reply.raw.end();
              resolve();
            });

            // 클라이언트 연결 종료 시 Docker 스트림도 종료
            request.raw.on('close', () => {
              if (closed) return;
              closed = true;
              req.destroy();
              resolve();
            });
          } else {
            // non-follow 모드 — JSON 배열 반환
            const chunks: Buffer[] = [];
            dockerRes.on('data', (c: Buffer) => chunks.push(c));
            dockerRes.on('end', () => {
              const raw = stripDockerHeader(Buffer.concat(chunks));
              const lines: LogLine[] = raw
                .split('\n')
                .map((l) => parseLine(l, service))
                .filter((l): l is LogLine => l !== null);
              reply.send(lines);
              resolve();
            });
            dockerRes.on('error', () => {
              reply.status(500).send({ error: 'Docker API 오류' });
              resolve();
            });
          }
        }
      );

      req.on('error', () => {
        reply.status(500).send({ error: 'Docker socket 연결 실패' });
        resolve();
      });

      req.end();
    });
  });
}
