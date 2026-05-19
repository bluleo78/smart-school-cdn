/// 서비스 헬스 모니터 — 5초마다 전체 서비스 상태를 수집해 메모리 캐시에 저장
/// 프론트엔드 요청 시 downstream 서비스를 직접 호출하지 않고 캐시를 반환한다.
/// proxy offline→online 전환 시 proxy + tls-service + dns-service 도메인 sync를 트리거한다.
import axios from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import { syncToProxy } from './routes/domains.js';
import type { DomainRepository } from './db/domain-repo.js';

interface ServiceStatus { online: boolean; latency_ms: number }

export interface ProxyStatus {
  online: boolean;
  uptime: number;
  request_count: number;
  /** 이슈 #427 — proxy 가 노출한 coalescer broadcast lag 누계. 기본 0 (구버전 proxy 호환). */
  coalescer_lagged_count?: number;
}

/** 이슈 #432 — 디스크 사용량 캐시. storage.stats() 결과를 5초 주기로 캐시. */
export interface DiskUsage {
  used_bytes: number;
  total_bytes: number;
  /** 0.0 ~ 1.0. total_bytes=0 이면 0. */
  usage_ratio: number;
}

export interface SystemStatus {
  proxy:     ServiceStatus;
  storage:   ServiceStatus;
  tls:       ServiceStatus;
  dns:       ServiceStatus;
  optimizer: ServiceStatus;
  /** 이슈 #432 — storage 디스크 사용량. storage offline 시 null. */
  disk:      DiskUsage | null;
}

interface GrpcClient { health: () => Promise<{ online: boolean; latency_ms: number }> }
/** 이슈 #432 — storage stats() 추가 호출용 확장 인터페이스 */
interface StorageWithStats extends GrpcClient {
  stats: () => Promise<{ used_bytes: number; total_bytes: number }>;
}

/** syncDomains를 지원하는 gRPC 클라이언트 (tls-service, dns-service) */
interface DomainEntry { host: string; origin: string }
interface SyncableGrpcClient extends GrpcClient {
  syncDomains: (domains: DomainEntry[]) => Promise<{ success: boolean }>;
}

interface Deps {
  proxyAdminUrl:   string;
  storageClient:   StorageWithStats;
  tlsClient:       SyncableGrpcClient;
  dnsClient:       SyncableGrpcClient;
  optimizerClient: GrpcClient;
  domainRepo:      DomainRepository;
  log:             FastifyBaseLogger;
}

const OFFLINE_PROXY:  ProxyStatus  = { online: false, uptime: 0, request_count: 0 };
const OFFLINE_SVC:    ServiceStatus = { online: false, latency_ms: -1 };
const OFFLINE_SYSTEM: SystemStatus = {
  proxy: OFFLINE_SVC, storage: OFFLINE_SVC, tls: OFFLINE_SVC, dns: OFFLINE_SVC, optimizer: OFFLINE_SVC,
  disk: null,
};

export class HealthMonitor {
  private proxyStatus:  ProxyStatus  = { ...OFFLINE_PROXY };
  private systemStatus: SystemStatus = { ...OFFLINE_SYSTEM };
  private proxyWasOnline = false;
  /** 이슈 #427 — coalescer_lagged_count 시계열. 5초 폴링마다 한 행 추가하고 60초 윈도우 밖은 폐기. */
  private laggedSamples: Array<{ ts: number; count: number }> = [];
  /** 1분 윈도우 size — 폴링 5초 간격 × 12 = 60초. Buffer overflow 안전을 위해 +1. */
  private static readonly LAGGED_WINDOW_MS = 60_000;

  constructor(private readonly deps: Deps) {}

  /** 캐시된 proxy 상태 반환 (proxy.ts 라우트용) */
  getProxyStatus(): ProxyStatus { return this.proxyStatus; }

  /** 캐시된 전체 서비스 상태 반환 (system.ts 라우트용) */
  getSystemStatus(): SystemStatus { return this.systemStatus; }

  /**
   * 이슈 #427 — 최근 1분 윈도우 동안의 coalescer lagged delta.
   * 무엇을: laggedSamples 중 (now - WINDOW) 이상 샘플들 중 가장 오래된 것과 가장 최근 것의 count 차.
   * 왜:    proxy 누계 카운터를 운영자 친화적 "최근 1분 발생률" 로 변환해 알림 임계로 사용.
   * 반환: 샘플이 2개 미만이거나 baseline 이 더 크면 0 (재시작·overflow 대응).
   */
  getCoalescerLaggedLastMinute(): number {
    const now = Date.now();
    const cutoff = now - HealthMonitor.LAGGED_WINDOW_MS;
    const within = this.laggedSamples.filter(s => s.ts >= cutoff);
    if (within.length < 2) return 0;
    const oldest = within[0]!.count;
    const newest = within[within.length - 1]!.count;
    return newest >= oldest ? newest - oldest : 0;
  }

  /** 테스트 보조 — 외부 시간 주입 없이 샘플 시드 가능하게 한다. */
  _pushLaggedSampleForTest(ts: number, count: number): void {
    this.laggedSamples.push({ ts, count });
  }

  /** 백그라운드 폴링 시작 */
  start(intervalMs = 5_000): void {
    // 즉시 1회 실행 후 주기 반복
    this.tick().catch(() => {});
    setInterval(() => this.tick().catch(() => {}), intervalMs);
  }

  /** 활성 도메인 목록을 tls-service + dns-service에 병렬 푸시.
   *  한 쪽 실패가 다른 쪽을 막지 않도록 allSettled 사용. */
  private async syncDomainsToGrpcServices(): Promise<void> {
    const domains = this.deps.domainRepo.findAll({ enabled: true }).map(d => ({
      host: d.host, origin: d.origin,
    }));
    const results = await Promise.allSettled([
      this.deps.tlsClient.syncDomains(domains),
      this.deps.dnsClient.syncDomains(domains),
    ]);
    const labels = ['tls-service', 'dns-service'];
    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        this.deps.log.warn({ err: r.reason }, `[health-monitor] ${labels[i]} 도메인 sync 실패`);
      } else {
        this.deps.log.info(`[health-monitor] ${labels[i]}에 도메인 ${domains.length}건 sync 완료`);
      }
    }
  }

  private async tick(): Promise<void> {
    const TIMEOUT = 2000;

    // ── Proxy 상태 (상세) ─────────────────────────────────────────
    const t0 = Date.now();
    let proxyOnline = false;
    try {
      const res = await axios.get(`${this.deps.proxyAdminUrl}/status`, { timeout: TIMEOUT });
      this.proxyStatus = res.data as ProxyStatus;
      proxyOnline = true;
      // 이슈 #427 — coalescer_lagged_count 시계열 갱신.
      // 윈도우 밖 샘플 폐기 + 신규 샘플 추가 (proxy 미지원 시 0 으로 안전 폴백).
      const now = Date.now();
      const cutoff = now - HealthMonitor.LAGGED_WINDOW_MS;
      this.laggedSamples = this.laggedSamples.filter(s => s.ts >= cutoff);
      this.laggedSamples.push({ ts: now, count: this.proxyStatus.coalescer_lagged_count ?? 0 });
    } catch {
      this.proxyStatus = { ...OFFLINE_PROXY };
    }
    const proxyLatency = proxyOnline ? Date.now() - t0 : -1;

    // offline → online 전환 감지 시 domain sync 트리거 (proxy + tls + dns)
    if (proxyOnline && !this.proxyWasOnline) {
      this.deps.log.info('proxy 온라인 전환 감지 — 3-서비스 도메인 sync 시작');
      syncToProxy(this.deps.domainRepo).catch(() => {});
      this.syncDomainsToGrpcServices().catch(err => {
        this.deps.log.warn({ err }, '[health-monitor] gRPC 도메인 sync 예외');
      });
    }
    this.proxyWasOnline = proxyOnline;

    // ── gRPC 서비스 상태 (병렬) ───────────────────────────────────
    const measure = async (fn: () => Promise<{ online: boolean; latency_ms: number }>): Promise<ServiceStatus> => {
      const t = Date.now();
      try {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT)),
        ]);
        return { online: result.online, latency_ms: Date.now() - t };
      } catch {
        return { ...OFFLINE_SVC };
      }
    };

    const [storage, tls, dns, optimizer] = await Promise.all([
      measure(() => this.deps.storageClient.health()),
      measure(() => this.deps.tlsClient.health()),
      measure(() => this.deps.dnsClient.health()),
      measure(() => this.deps.optimizerClient.health()),
    ]);

    // 이슈 #432 — storage 디스크 사용량 동시 폴링. storage offline 또는 stats 실패 시 null.
    let disk: DiskUsage | null = null;
    if (storage.online) {
      try {
        const s = await Promise.race([
          this.deps.storageClient.stats(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT)),
        ]);
        const total = Number(s.total_bytes ?? 0);
        const used  = Number(s.used_bytes  ?? 0);
        disk = {
          used_bytes:  used,
          total_bytes: total,
          usage_ratio: total > 0 ? used / total : 0,
        };
      } catch {
        // stats 실패는 disk=null 로 fallback. health 와 무관하게 처리.
      }
    }

    this.systemStatus = {
      proxy: { online: proxyOnline, latency_ms: proxyLatency },
      storage, tls, dns, optimizer,
      disk,
    };
  }
}
