/// 이슈 #367 — TLS 인증서 만료 사전 알림.
///
/// 무엇을: 주기적으로 tls-service 의 인증서 목록을 조회해 만료 임박 임계 (30/14/7/1 일) 에 도달한
///        도메인에 대해 단발성 알림을 발송한다. 동일 (domain, threshold_day) 쌍은 한 번만 발송.
/// 왜: 학교 내부 사설 CA / Let's Encrypt 인증서 만료로 인한 iPad 전체 통신 중단 사고 사전 차단.
///    운영자가 admin-web 미접속이어도 외부 알림 채널(webhook) 로 사고 예방 가능.
/// 동작:
///   - 백그라운드 setInterval (기본 6시간, env TLS_SCAN_INTERVAL_MS 조정)
///   - tls-service listCertificates() 호출
///   - 도메인별 days_until_expiry 계산
///   - 임계값 [30, 14, 7, 1] 중 도달한 가장 낮은 임계에서 한 번만 발송
///   - tls_expiry_alerts 테이블에 (domain, threshold_day, fired_at) 저장하여 중복 차단
///   - 모든 sink 에 발송 (LogSink 는 항상, WebhookSink 는 env 설정 시)
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger } from 'fastify';

/** 발송 추적 테이블 — 중복 알림 차단용. PK (domain, threshold_day) */
export const TLS_EXPIRY_ALERTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tls_expiry_alerts (
    domain         TEXT    NOT NULL,
    threshold_day  INTEGER NOT NULL,
    fired_at       INTEGER NOT NULL,
    PRIMARY KEY (domain, threshold_day)
  );
`;

/** 알림 임계 — 만료 N 일 이하 진입 시점에 단발 발송. 내림차순 정렬해 도달한 가장 낮은 임계만 매칭. */
const THRESHOLDS = [30, 14, 7, 1] as const;
type Threshold = (typeof THRESHOLDS)[number];

/** 알림 페이로드 — sink 가 사용 */
export interface TlsExpiryAlert {
  domain: string;
  threshold_day: Threshold;
  days_until_expiry: number;
  expires_at: string;
}

/** 알림 sink 인터페이스 — 플러그인 구조 */
export interface AlertSink {
  name: string;
  send(alert: TlsExpiryAlert): Promise<void>;
}

/** 기본 sink — pino warn 으로 로그 출력 */
export class LogSink implements AlertSink {
  readonly name = 'log';
  constructor(private readonly log: Pick<FastifyBaseLogger, 'warn'>) {}
  async send(alert: TlsExpiryAlert): Promise<void> {
    this.log.warn(
      { ...alert },
      `[tls-expiry] ${alert.domain} 인증서 ${alert.days_until_expiry}일 후 만료 (임계 ${alert.threshold_day}일)`,
    );
  }
}

/** webhook sink — JSON POST. TLS_ALERT_WEBHOOK_URL env 설정 시 활성. */
export class WebhookSink implements AlertSink {
  readonly name = 'webhook';
  constructor(private readonly url: string, private readonly log: Pick<FastifyBaseLogger, 'warn'>) {}
  async send(alert: TlsExpiryAlert): Promise<void> {
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'tls_expiring', ...alert }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      this.log.warn({ err, url: this.url }, '[tls-expiry] webhook 발송 실패');
    }
  }
}

/** sink 생성 — env 기반 자동 구성 */
export function createSinksFromEnv(log: Pick<FastifyBaseLogger, 'warn'>): AlertSink[] {
  const sinks: AlertSink[] = [new LogSink(log)];
  const url = process.env.TLS_ALERT_WEBHOOK_URL;
  if (url && url.length > 0) {
    sinks.push(new WebhookSink(url, log));
  }
  return sinks;
}

/** 인증서 한 건의 expires_at 으로부터 도달한 가장 낮은 임계 반환 (없으면 null) */
export function matchThreshold(daysUntilExpiry: number): Threshold | null {
  if (daysUntilExpiry < 0) return null; // 이미 만료된 건은 별도 처리 (#367 에서는 범위 밖)
  // [30, 14, 7, 1] 내림차순 — daysUntilExpiry 가 t 이하인 가장 작은(= 가장 임박한) t 선택.
  let matched: Threshold | null = null;
  for (const t of THRESHOLDS) {
    if (daysUntilExpiry <= t) {
      matched = t; // 더 작은 t 가 나오면 갱신 → 가장 임박한 임계
    }
  }
  return matched;
}

export interface ScannerOpts {
  db: Database.Database;
  tlsClient: { listCertificates: () => Promise<{ certs: Array<{ domain: string; expires_at: string }> }> };
  sinks: AlertSink[];
  log: Pick<FastifyBaseLogger, 'warn' | 'info' | 'error'>;
  /** 현재 시각 provider — 테스트에서 주입 */
  now?: () => number;
}

export class TlsExpiryScanner {
  private readonly now: () => number;
  constructor(private readonly opts: ScannerOpts) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** 1회 스캔 — 새로 임계 진입한 도메인에 대해 sink 들로 알림 발송 후 DB 기록. 발송 건수 반환. */
  async tick(): Promise<number> {
    let res;
    try {
      res = await this.opts.tlsClient.listCertificates();
    } catch (err) {
      this.opts.log.warn({ err }, '[tls-expiry-scanner] listCertificates 실패');
      return 0;
    }
    const nowMs = this.now();
    let fired = 0;
    const alreadyFired = this.opts.db.prepare(
      'SELECT 1 FROM tls_expiry_alerts WHERE domain = ? AND threshold_day = ?',
    );
    const insert = this.opts.db.prepare(
      'INSERT OR IGNORE INTO tls_expiry_alerts (domain, threshold_day, fired_at) VALUES (?, ?, ?)',
    );
    for (const cert of res.certs ?? []) {
      const expiresMs = Date.parse(cert.expires_at);
      if (!Number.isFinite(expiresMs)) continue;
      const days = Math.floor((expiresMs - nowMs) / 86400000);
      const t = matchThreshold(days);
      if (t === null) continue;
      const dup = alreadyFired.get(cert.domain, t);
      if (dup) continue;
      const alert: TlsExpiryAlert = {
        domain: cert.domain,
        threshold_day: t,
        days_until_expiry: days,
        expires_at: cert.expires_at,
      };
      // 발송 — 일부 sink 실패해도 다른 sink 는 계속 시도. allSettled.
      await Promise.allSettled(this.opts.sinks.map((s) => s.send(alert)));
      insert.run(cert.domain, t, Math.floor(nowMs / 1000));
      fired += 1;
    }
    if (fired > 0) this.opts.log.info({ fired }, '[tls-expiry-scanner] 알림 발송 완료');
    return fired;
  }
}

/** 부팅 시 호출 — 즉시 1회 + setInterval 주기 실행. 기본 6시간 (TLS_SCAN_INTERVAL_MS 로 조정) */
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
export function startTlsExpiryScanner(
  opts: ScannerOpts,
  intervalMs?: number,
): { stop: () => void; scanner: TlsExpiryScanner } {
  const scanner = new TlsExpiryScanner(opts);
  const envMs = Number(process.env.TLS_SCAN_INTERVAL_MS);
  const interval = intervalMs ?? (Number.isFinite(envMs) && envMs > 0 ? envMs : DEFAULT_INTERVAL_MS);
  // 부팅 직후 1회 — 장기 다운타임 후 즉시 catch up
  scanner.tick().catch(() => {});
  const timer = setInterval(() => void scanner.tick().catch(() => {}), interval);
  return { stop: () => clearInterval(timer), scanner };
}
