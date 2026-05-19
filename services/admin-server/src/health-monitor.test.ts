/// HealthMonitor 단위 테스트
/// proxy offline→online 전환 시 tls/dns-service 도메인 sync 동작을 검증한다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthMonitor } from './health-monitor.js';
import type { DomainRepository, Domain } from './db/domain-repo.js';

// ── 헬퍼 팩토리 ───────────────────────────────────────────────────────────────

/** 활성 도메인 목록을 반환하는 mock DomainRepository */
function makeMockRepo(domains: Array<{ host: string; origin: string }>): DomainRepository {
  const rows: Domain[] = domains.map(d => ({
    host: d.host,
    origin: d.origin,
    enabled: 1,
    description: '',
    created_at: 0,
    updated_at: 0,
  }));
  return {
    findAll: vi.fn(() => rows),
  } as unknown as DomainRepository;
}

/** gRPC 클라이언트 mock 생성 */
function makeGrpcClient(overrides: Record<string, unknown> = {}) {
  return {
    health: vi.fn().mockResolvedValue({ online: true, latency_ms: 1 }),
    syncDomains: vi.fn().mockResolvedValue({ success: true }),
    // 이슈 #432 — StorageWithStats 호환. storage 외 클라이언트도 동일 시그니처면 무해.
    stats: vi.fn().mockResolvedValue({ used_bytes: 0, total_bytes: 0 }),
    ...overrides,
  };
}

/** 조용한 logger mock */
function quietLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** 기본 Deps 생성 — proxy HTTP는 axios가 호출하므로 proxyAdminUrl만 설정 */
function makeDeps(opts: {
  proxyOnline?: boolean;
  tlsOverrides?: Record<string, unknown>;
  dnsOverrides?: Record<string, unknown>;
  domains?: Array<{ host: string; origin: string }>;
} = {}) {
  const { proxyOnline = true, tlsOverrides = {}, dnsOverrides = {}, domains = [
    { host: 'school.test', origin: 'https://origin.test' },
  ] } = opts;

  const tlsClient = makeGrpcClient(tlsOverrides);
  const dnsClient = makeGrpcClient(dnsOverrides);
  const repo = makeMockRepo(domains);
  const log = quietLog();

  return { tlsClient, dnsClient, repo, log, proxyOnline };
}

// axios mock — proxy HTTP 응답 제어
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// syncToProxy mock — proxy HTTP sync는 이 테스트 범위 밖
vi.mock('./routes/domains.js', () => ({
  syncToProxy: vi.fn().mockResolvedValue(undefined),
}));

import axios from 'axios';
import { syncToProxy } from './routes/domains.js';

// ── tick() 헬퍼 — HealthMonitor를 생성하고 tick을 직접 호출 ─────────────────

async function runTick(deps: ReturnType<typeof makeDeps>, proxyOnline: boolean) {
  const axiosMock = vi.mocked(axios.get);
  if (proxyOnline) {
    axiosMock.mockResolvedValue({ data: { online: true, uptime: 0, request_count: 0 } });
  } else {
    axiosMock.mockRejectedValue(new Error('offline'));
  }

  const monitor = new HealthMonitor({
    proxyAdminUrl: 'http://proxy:8081',
    storageClient: makeGrpcClient(),
    optimizerClient: makeGrpcClient(),
    tlsClient: deps.tlsClient,
    dnsClient: deps.dnsClient,
    domainRepo: deps.repo,
    log: deps.log as never,
  });

  // tick은 private — any 캐스트로 직접 호출
  await (monitor as unknown as { tick: () => Promise<void> }).tick();

  return monitor;
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

describe('HealthMonitor — proxy offline→online 전환 시 gRPC 도메인 sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proxy가 offline→online 전환되면 tlsClient.syncDomains와 dnsClient.syncDomains가 호출된다', async () => {
    const deps = makeDeps({ domains: [{ host: 'a.test', origin: 'https://a.origin' }] });

    // 최초 tick: proxyWasOnline=false → proxyOnline=true → 전환 감지
    await runTick(deps, true);

    expect(deps.tlsClient.syncDomains).toHaveBeenCalledOnce();
    expect(deps.dnsClient.syncDomains).toHaveBeenCalledOnce();
    // 도메인 목록이 올바르게 전달되었는지 확인
    expect(deps.tlsClient.syncDomains).toHaveBeenCalledWith([
      { host: 'a.test', origin: 'https://a.origin' },
    ]);
    expect(deps.dnsClient.syncDomains).toHaveBeenCalledWith([
      { host: 'a.test', origin: 'https://a.origin' },
    ]);
  });

  it('repo.findAll는 enabled: true 필터로 호출된다', async () => {
    const deps = makeDeps();
    await runTick(deps, true);

    expect(deps.repo.findAll).toHaveBeenCalledWith({ enabled: true });
  });

  it('proxy가 이미 online 상태를 유지하면 두 번째 tick에서 syncDomains를 재호출하지 않는다', async () => {
    const deps = makeDeps();
    const axiosMock = vi.mocked(axios.get);
    axiosMock.mockResolvedValue({ data: { online: true, uptime: 0, request_count: 0 } });

    const monitor = new HealthMonitor({
      proxyAdminUrl: 'http://proxy:8081',
      storageClient: makeGrpcClient(),
      optimizerClient: makeGrpcClient(),
      tlsClient: deps.tlsClient,
      dnsClient: deps.dnsClient,
      domainRepo: deps.repo,
      log: deps.log as never,
    });

    const tickFn = (monitor as unknown as { tick: () => Promise<void> }).tick.bind(monitor);

    // 1차: offline→online 전환
    await tickFn();
    expect(deps.tlsClient.syncDomains).toHaveBeenCalledTimes(1);

    // 2차: online→online 유지 — 추가 호출 없음
    await tickFn();
    expect(deps.tlsClient.syncDomains).toHaveBeenCalledTimes(1);
    expect(deps.dnsClient.syncDomains).toHaveBeenCalledTimes(1);
  });

  it('tlsClient.syncDomains가 reject되어도 dnsClient.syncDomains는 호출된다 (Promise.allSettled)', async () => {
    const deps = makeDeps({
      tlsOverrides: {
        syncDomains: vi.fn().mockRejectedValue(new Error('tls-service 오프라인')),
      },
    });

    await runTick(deps, true);

    // tls 실패에도 dns는 호출되어야 한다
    expect(deps.tlsClient.syncDomains).toHaveBeenCalledOnce();
    expect(deps.dnsClient.syncDomains).toHaveBeenCalledOnce();
    // 경고 로그가 기록되어야 한다
    expect(deps.log.warn).toHaveBeenCalled();
  });

  it('dnsClient.syncDomains가 reject되어도 tlsClient.syncDomains는 호출된다 (Promise.allSettled)', async () => {
    const deps = makeDeps({
      dnsOverrides: {
        syncDomains: vi.fn().mockRejectedValue(new Error('dns-service 오프라인')),
      },
    });

    await runTick(deps, true);

    expect(deps.tlsClient.syncDomains).toHaveBeenCalledOnce();
    expect(deps.dnsClient.syncDomains).toHaveBeenCalledOnce();
    expect(deps.log.warn).toHaveBeenCalled();
  });

  it('proxy가 계속 offline이면 syncDomains가 호출되지 않는다', async () => {
    const deps = makeDeps({ proxyOnline: false });
    await runTick(deps, false);

    expect(deps.tlsClient.syncDomains).not.toHaveBeenCalled();
    expect(deps.dnsClient.syncDomains).not.toHaveBeenCalled();
  });

  it('syncToProxy도 offline→online 전환 시 호출된다', async () => {
    const deps = makeDeps();
    await runTick(deps, true);

    expect(syncToProxy).toHaveBeenCalledOnce();
  });
});

// ── #427 — coalescer lagged 1분 윈도우 delta ──────────────────────────────
describe('HealthMonitor — #427 coalescer lagged last-minute delta', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function makeMonitor() {
    const deps = makeDeps();
    return new HealthMonitor({
      proxyAdminUrl: 'http://proxy:8081',
      storageClient: makeGrpcClient(),
      optimizerClient: makeGrpcClient(),
      tlsClient: deps.tlsClient,
      dnsClient: deps.dnsClient,
      domainRepo: deps.repo,
      log: deps.log as never,
    });
  }

  it('샘플이 1개 이하면 0 반환 (baseline 없음)', () => {
    const m = makeMonitor();
    expect(m.getCoalescerLaggedLastMinute()).toBe(0);
    m._pushLaggedSampleForTest(Date.now(), 100);
    expect(m.getCoalescerLaggedLastMinute()).toBe(0);
  });

  it('윈도우 내 newest - oldest 차이를 반환', () => {
    const m = makeMonitor();
    const now = Date.now();
    m._pushLaggedSampleForTest(now - 55_000, 10);
    m._pushLaggedSampleForTest(now - 30_000, 12);
    m._pushLaggedSampleForTest(now -  5_000, 17);
    expect(m.getCoalescerLaggedLastMinute()).toBe(7); // 17 - 10
  });

  it('윈도우 밖 샘플은 무시한다 (1분 경계)', () => {
    const m = makeMonitor();
    const now = Date.now();
    m._pushLaggedSampleForTest(now - 70_000, 100); // 윈도우 밖
    m._pushLaggedSampleForTest(now - 50_000, 105);
    m._pushLaggedSampleForTest(now -  1_000, 108);
    expect(m.getCoalescerLaggedLastMinute()).toBe(3); // 108 - 105
  });

  it('proxy 재시작으로 카운터 reset 되면 0 반환 (음수 방지)', () => {
    const m = makeMonitor();
    const now = Date.now();
    m._pushLaggedSampleForTest(now - 30_000, 999);
    m._pushLaggedSampleForTest(now -  1_000, 5); // 재시작
    expect(m.getCoalescerLaggedLastMinute()).toBe(0);
  });
});

// ── #432 — storage 디스크 사용량 캐시 ───────────────────────────────────────
describe('HealthMonitor — #432 disk usage cache', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** disk 검증 전용 monitor 생성 — storage stats 응답을 주입 */
  async function tickWithStorage(opts: {
    storageOnline?: boolean;
    statsResult?: { used_bytes: number; total_bytes: number } | Error;
  }) {
    const { storageOnline = true, statsResult = { used_bytes: 0, total_bytes: 0 } } = opts;
    vi.mocked(axios.get).mockResolvedValue({ data: { online: true, uptime: 0, request_count: 0 } });

    const storageClient = makeGrpcClient({
      health: vi.fn().mockResolvedValue({ online: storageOnline, latency_ms: 1 }),
      stats: statsResult instanceof Error
        ? vi.fn().mockRejectedValue(statsResult)
        : vi.fn().mockResolvedValue(statsResult),
    });
    const deps = makeDeps();
    const monitor = new HealthMonitor({
      proxyAdminUrl: 'http://proxy:8081',
      storageClient,
      optimizerClient: makeGrpcClient(),
      tlsClient: deps.tlsClient,
      dnsClient: deps.dnsClient,
      domainRepo: deps.repo,
      log: deps.log as never,
    });
    await (monitor as unknown as { tick: () => Promise<void> }).tick();
    return { monitor, storageClient };
  }

  it('storage.stats() 응답으로 usage_ratio 를 계산한다 (used/total)', async () => {
    const { monitor } = await tickWithStorage({
      statsResult: { used_bytes: 400, total_bytes: 1000 },
    });
    expect(monitor.getSystemStatus().disk).toEqual({
      used_bytes: 400,
      total_bytes: 1000,
      usage_ratio: 0.4,
    });
  });

  it('total_bytes=0 이면 usage_ratio=0 으로 안전 처리한다', async () => {
    const { monitor } = await tickWithStorage({
      statsResult: { used_bytes: 0, total_bytes: 0 },
    });
    expect(monitor.getSystemStatus().disk?.usage_ratio).toBe(0);
  });

  it('storage offline 이면 disk 는 null 이다', async () => {
    const { monitor, storageClient } = await tickWithStorage({ storageOnline: false });
    expect(monitor.getSystemStatus().disk).toBeNull();
    // health 가 offline 이면 stats 자체를 호출하지 않는다 (불필요한 RPC 차단)
    expect(storageClient.stats).not.toHaveBeenCalled();
  });

  it('storage online 이지만 stats() 가 실패하면 disk=null 로 fallback (시스템 상태는 유지)', async () => {
    const { monitor } = await tickWithStorage({ statsResult: new Error('stats rpc fail') });
    expect(monitor.getSystemStatus().disk).toBeNull();
    expect(monitor.getSystemStatus().storage.online).toBe(true);
  });
});
