/// 프록시 상태/요청 로그 API 라우트
/// Proxy Service의 관리 API(8081)를 호출하여 결과를 중계한다.
/// Proxy 서버가 내려가 있으면 오프라인 상태로 응답한다.
import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import https from 'https';
import type { DomainRepository } from '../db/domain-repo.js';
import { writeRateLimit, WRITE_LIMIT_BURST_PER_MIN } from '../rate-limit-config.js';

/** Proxy 관리 API 기본 URL */
const PROXY_ADMIN_URL = process.env.PROXY_ADMIN_URL || 'http://localhost:8081';

/**
 * 프록시 테스트 응답에서 수집할 헤더 목록
 * CDN 동작 확인(캐시 히트/미스, 콘텐츠 타입, ETag)에 직접 필요한 헤더만 선택
 */
const RELEVANT_HEADERS = ['x-cache', 'x-cache-status', 'content-type', 'cache-control', 'etag'] as const;

/** 프록시 서버 URL — HTTP 테스트 요청 대상 */
const PROXY_URL = process.env.PROXY_HTTP_URL || 'http://localhost:8080';
/** 프록시 HTTPS URL — HTTPS 테스트 요청 대상 */
const PROXY_HTTPS_URL = process.env.PROXY_HTTPS_URL || 'https://localhost:443';
/** HTTPS 테스트용 Agent — 자체 CA이므로 인증서 검증 생략 (내부 테스트 전용) */
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/** 연결 타임아웃 (3초) — Proxy 서버가 내려가 있을 때 빠르게 실패하도록 */
const TIMEOUT_MS = 3000;

/**
 * 프록시 테스트 에러 분류 결과
 * - `error_code`: 머신 가독 키 (UI 분기·로깅 태그 용도, 화이트리스트)
 * - `message`: 사용자 표시용 한국어 문장 (OpenSSL/Node 내부 메시지·경로 비포함)
 */
interface ClassifiedError {
  error_code: string;
  message: string;
}

/**
 * axios/Node 에러를 사용자 친화 카테고리로 분류한다 (#166).
 *
 * 왜: axios가 throw하는 err.message는 OpenSSL 내부 빌드 경로
 * (`../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918`), 라이브러리 심볼,
 * SSL alert 번호 등 내부 진단 정보를 포함한다. 이를 그대로 클라이언트에 흘리면:
 *   1) 외부 사용자에게 의미 불명의 영문 stack-like 메시지가 노출되어 UX 결함
 *   2) 내부 의존성 단서 노출 (낮은 위험이지만 내부망 전용 어드민도 모범상 차단)
 *
 * 따라서 `err.code`(Node syscall errno) + 메시지 패턴 매칭으로 카테고리를 결정하고,
 * 미리 정의된 한국어 한 문장만 반환한다. raw err.message는 호출부에서 pino로만 기록.
 */
function classifyProxyError(err: unknown): ClassifiedError {
  // Node/axios 공통: err.code (string), err.message (string)
  const code = typeof (err as { code?: unknown })?.code === 'string'
    ? ((err as { code: string }).code)
    : undefined;
  const rawMessage = err instanceof Error ? err.message : '';

  // 1) 연결 거부 — Proxy 서버 자체가 내려간 경우 가장 흔함
  if (code === 'ECONNREFUSED') {
    return { error_code: 'connection_refused', message: '프록시 서버에 연결할 수 없습니다.' };
  }
  // 2) 호스트 미해석 / DNS 실패
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { error_code: 'host_not_found', message: '프록시 서버 호스트를 찾을 수 없습니다.' };
  }
  // 3) 타임아웃 — axios timeout / socket timeout / connect timeout
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ECONNABORTED') {
    return { error_code: 'timeout', message: '요청 시간이 초과되었습니다.' };
  }
  // 4) 연결 끊김
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return { error_code: 'connection_reset', message: '프록시 서버와의 연결이 끊어졌습니다.' };
  }
  // 5) TLS 인증서 만료/검증 실패 — Node TLS errno 화이트리스트
  if (code === 'CERT_HAS_EXPIRED' || code === 'CERT_NOT_YET_VALID') {
    return { error_code: 'cert_expired', message: 'TLS 인증서가 만료되었거나 아직 유효하지 않습니다.' };
  }
  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'UNABLE_TO_GET_ISSUER_CERT' ||
    code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
  ) {
    return { error_code: 'cert_invalid', message: 'TLS 인증서를 검증할 수 없습니다.' };
  }
  // 6) TLS/SSL 핸드셰이크 실패 — EPROTO + OpenSSL alert. raw 메시지는 절대 노출 금지
  if (code === 'EPROTO' || /SSL routines|tlsv1 alert|ssl3_/i.test(rawMessage)) {
    return { error_code: 'tls_handshake_failed', message: 'TLS 핸드셰이크에 실패했습니다.' };
  }
  // 7) 그 외 — 카테고리 미상. 분류 화이트리스트 외 메시지는 절대 그대로 노출하지 않는다.
  return { error_code: 'unknown', message: '프록시 요청에 실패했습니다.' };
}

/** 라우트 옵션 — domainRepo가 있으면 테스트 엔드포인트에서 SSRF 방어용 도메인 검증에 사용 */
interface ProxyRouteOptions {
  domainRepo?: DomainRepository;
}

export async function proxyRoutes(app: FastifyInstance, opts: ProxyRouteOptions = {}) {
  const { domainRepo } = opts;

  /** 프록시 상태 조회 — HealthMonitor 캐시 반환 (downstream 직접 호출 없음) */
  app.get('/api/proxy/status', async () => app.healthMonitor.getProxyStatus());

  /** 최근 요청 로그 조회 — URL, 상태코드, 응답시간, 타임스탬프 */
  app.get('/api/proxy/requests', async () => {
    try {
      // Proxy 관리 API에서 요청 로그 조회
      const res = await axios.get(`${PROXY_ADMIN_URL}/requests`, {
        timeout: TIMEOUT_MS,
      });
      return res.data;
    } catch {
      // Proxy 서버 연결 실패 → 빈 배열 반환
      return [];
    }
  });

  /**
   * 프록시 테스트 — 지정 도메인+경로로 프록시를 통해 실제 요청을 전송하고 결과를 반환한다.
   * Admin Dashboard의 도메인 관리 페이지에서 도메인 등록 후 동작 확인에 사용한다.
   *
   * 보안:
   * - domainRepo가 있으면 등록된 도메인만 허용 (SSRF 방어)
   * - path에 상대 경로(..) 또는 @ 포함 시 400 반환 (URL 조작 방지)
   */
  app.post<{
    Body: { domain: string; path: string; protocol?: 'http' | 'https' };
  }>('/api/proxy/test', { config: writeRateLimit(WRITE_LIMIT_BURST_PER_MIN) }, async (request, reply) => {  // #370 throttle (외부 fetch 트리거)
    // 빈/누락/null 바디 가드 — request.body가 undefined·null이면 destructure가 TypeError를 throw하고
    // setErrorHandler가 5xx 셰이프({error:'internal_error', message})로 노출되어 내부 변수명(`domain` 등)이
    // 클라이언트에 새어나간다(#359 정보 노출). 다른 라우트(domains.ts)와 동일하게 `?? {}`로 가드하여
    // 누락 시 표준 400 invalid_input envelope으로 정규화한다.
    const body = (request.body ?? {}) as { domain?: string; path?: string; protocol?: 'http' | 'https' };
    const { domain: rawDomain, path, protocol = 'http' } = body;

    if (!rawDomain || !path) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_input',
        message: 'domain과 path는 필수 항목입니다.',
      });
    }

    // 도메인 입력 정규화 — DNS 호스트는 case-insensitive(RFC 1035 §2.3.3)이고
    // 사용자 입력에 앞뒤 공백이 섞일 수 있어 도메인 등록/조회 라우트(#190·#201)와 동일하게
    // `trim().toLowerCase()` 로 정규화한다. SSRF 검증·후속 Host 헤더 모두 정규화 값 사용.
    const domain = typeof rawDomain === 'string' ? rawDomain.trim().toLowerCase() : rawDomain;

    // SSRF 방어 — 등록된 도메인만 허용
    if (domainRepo) {
      const found = domainRepo.findByHost(domain);
      if (!found) {
        // 표준 envelope (#327)
        return reply.status(400).send({
          error: 'domain_not_registered',
          message: '등록되지 않은 도메인입니다.',
        });
      }
    }

    // URL 조작 방지 — 인코딩 해제 후 상대 경로(..), 프로토콜 상대 URL(//), @ 포함 시 거부
    // 잘못된 percent-encoding(`%ZZ`, `%FF` 등)이면 decodeURIComponent가 URIError를 throw하므로
    // try/catch로 감싸 400 invalid_path로 표준화한다 (#347 도메인 라우트와 동일 패턴, #360).
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      // 표준 envelope (#327) — 잘못된 인코딩은 사용자 입력 오류이므로 400
      return reply.status(400).send({
        error: 'invalid_path',
        message: '유효하지 않은 경로입니다.',
      });
    }
    if (decodedPath.includes('..') || path.startsWith('//') || path.includes('@')) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_path',
        message: '유효하지 않은 경로입니다.',
      });
    }
    // path는 슬래시(/)로 시작해야 한다 — 방어 심층화(#166).
    // 그렇지 않으면 baseUrl + `/${path}` 정규화 후 origin에 도달해 TLS 핸드셰이크 단계의
    // raw OpenSSL 에러를 유발하는 경로가 열린다. 서버에서 명시적으로 거부해 raw 에러 노출 표면을 줄인다.
    if (!path.startsWith('/')) {
      return reply.status(400).send({
        error: 'invalid_path',
        message: '경로는 "/"로 시작해야 합니다.',
      });
    }

    const baseUrl = protocol === 'https' ? PROXY_HTTPS_URL : PROXY_URL;
    const targetUrl = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const startMs = Date.now();

    try {
      // 프록시 서버에 Host 헤더를 설정하여 요청 — 프록시가 Host 기반으로 원본 서버를 선택한다.
      const res = await axios.get(targetUrl, {
        headers: { Host: domain },
        timeout: 10000,
        // 리다이렉트 및 오류 응답도 그대로 받아서 status_code를 반환한다.
        validateStatus: () => true,
        // HTTPS 테스트: 자체 CA이므로 인증서 검증 생략
        ...(protocol === 'https' ? { httpsAgent } : {}),
      });

      // CDN 관련 주요 헤더만 선택적으로 수집한다 — 전체 헤더 노출 방지 + 클라이언트 표시 최적화
      const response_headers: Record<string, string> = {};
      for (const k of RELEVANT_HEADERS) {
        const v = res.headers[k];
        if (v !== undefined && v !== null) response_headers[k] = String(v);
      }

      return {
        success: true,
        status_code: res.status,
        response_time_ms: Date.now() - startMs,
        response_headers,
      };
    } catch (err) {
      // axios/Node 에러 분류 — raw OpenSSL/Node 메시지를 절대 그대로 노출하지 않는다 (#166).
      // 디버그용 raw 정보는 pino 로그에만 기록하고, 응답에는 화이트리스트 매핑된
      // error_code + 사용자 친화 한국어 message만 반환한다.
      const classified = classifyProxyError(err);
      const rawMessage = err instanceof Error ? err.message : String(err);
      const rawCode = typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : undefined;
      app.log.warn(
        { err, code: rawCode, raw_message: rawMessage, domain, path, protocol, classified: classified.error_code },
        '[proxy/test] 프록시 요청 실패',
      );
      return {
        success: false,
        status_code: 0,
        response_time_ms: Date.now() - startMs,
        error_code: classified.error_code,
        error: classified.message,
      };
    }
  });
}
