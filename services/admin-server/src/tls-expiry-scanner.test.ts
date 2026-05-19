/// TlsExpiryScanner 단위 테스트 (#367).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import {
  TLS_EXPIRY_ALERTS_SCHEMA,
  TlsExpiryScanner,
  matchThreshold,
  type AlertSink,
  type TlsExpiryAlert,
} from './tls-expiry-scanner.js';

const quietLog = () => ({ warn: () => {}, info: () => {}, error: () => {} });

function mkDb() {
  const db = new Database(':memory:');
  db.exec(TLS_EXPIRY_ALERTS_SCHEMA);
  return db;
}

class RecordingSink implements AlertSink {
  readonly name = 'recording';
  fired: TlsExpiryAlert[] = [];
  async send(a: TlsExpiryAlert): Promise<void> { this.fired.push(a); }
}

function mockTlsClient(certs: Array<{ domain: string; expires_at: string }>) {
  return { listCertificates: async () => ({ certs }) };
}

const NOW = new Date('2026-06-01T00:00:00Z').getTime();
const isoPlusDays = (n: number) => new Date(NOW + n * 86400_000).toISOString();

describe('matchThreshold', () => {
  it('30일 초과는 임계 매칭 없음', () => {
    expect(matchThreshold(31)).toBeNull();
    expect(matchThreshold(60)).toBeNull();
  });
  it('30일 이하 ~ 14일 초과는 30일 임계', () => {
    expect(matchThreshold(30)).toBe(30);
    expect(matchThreshold(15)).toBe(30);
  });
  it('14일 이하 ~ 7일 초과는 14일 임계', () => {
    expect(matchThreshold(14)).toBe(14);
    expect(matchThreshold(8)).toBe(14);
  });
  it('7일 이하 ~ 1일 초과는 7일 임계', () => {
    expect(matchThreshold(7)).toBe(7);
    expect(matchThreshold(2)).toBe(7);
  });
  it('1일 이하는 1일 임계 (가장 임박)', () => {
    expect(matchThreshold(1)).toBe(1);
    expect(matchThreshold(0)).toBe(1);
  });
  it('음수(이미 만료)는 임계 매칭 없음 — 범위 밖', () => {
    expect(matchThreshold(-1)).toBeNull();
  });
});

describe('TlsExpiryScanner', () => {
  it('임계 진입 도메인에 알림 발송 + DB 기록 — 두 번째 tick 은 중복 차단', async () => {
    const db = mkDb();
    const sink = new RecordingSink();
    const tlsClient = mockTlsClient([
      { domain: 'soon.example', expires_at: isoPlusDays(5) },   // 7일 임계
      { domain: 'later.example', expires_at: isoPlusDays(20) }, // 30일 임계
      { domain: 'safe.example',  expires_at: isoPlusDays(60) }, // 임계 밖
    ]);
    const scanner = new TlsExpiryScanner({
      db, tlsClient, sinks: [sink], log: quietLog(), now: () => NOW,
    });

    expect(await scanner.tick()).toBe(2);
    expect(sink.fired.map((a) => `${a.domain}:${a.threshold_day}`)).toEqual([
      'soon.example:7',
      'later.example:30',
    ]);

    // 두 번째 tick — 동일 (domain, threshold_day) 는 중복 차단되어 발송 0건
    sink.fired = [];
    expect(await scanner.tick()).toBe(0);
    expect(sink.fired).toHaveLength(0);
  });

  it('인증서가 임계를 깊게 넘어가면 더 임박한 임계로 추가 알림', async () => {
    const db = mkDb();
    const sink = new RecordingSink();

    // 1차: soon 이 30일 임계 진입
    const t1 = mockTlsClient([{ domain: 'soon.example', expires_at: isoPlusDays(20) }]);
    const s1 = new TlsExpiryScanner({ db, tlsClient: t1, sinks: [sink], log: quietLog(), now: () => NOW });
    expect(await s1.tick()).toBe(1);
    expect(sink.fired[0].threshold_day).toBe(30);

    // 2차: 같은 도메인이 7일 임계로 깊어진 시점 — 7일 임계로 추가 발송
    sink.fired = [];
    const t2 = mockTlsClient([{ domain: 'soon.example', expires_at: isoPlusDays(5) }]);
    const s2 = new TlsExpiryScanner({ db, tlsClient: t2, sinks: [sink], log: quietLog(), now: () => NOW });
    expect(await s2.tick()).toBe(1);
    expect(sink.fired[0].threshold_day).toBe(7);
  });

  it('listCertificates 실패는 swallow — 다음 tick 에 재시도', async () => {
    const db = mkDb();
    const sink = new RecordingSink();
    const failing = { listCertificates: async () => { throw new Error('boom'); } };
    const scanner = new TlsExpiryScanner({
      db, tlsClient: failing, sinks: [sink], log: quietLog(), now: () => NOW,
    });
    expect(await scanner.tick()).toBe(0);
    expect(sink.fired).toHaveLength(0);
  });
});
