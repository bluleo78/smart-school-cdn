/// 서비스 헬스 모니터 — 5초마다 전체 서비스 상태를 수집해 메모리 캐시에 저장
/// 프론트엔드 요청 시 downstream 서비스를 직접 호출하지 않고 캐시를 반환한다.
/// proxy offline→online 전환 시 proxy + tls-service + dns-service 도메인 sync를 트리거한다.
import axios from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import { syncToProxy } from './routes/domains.js';
import type { DomainRepository } from './db/domain-repo.js';

interface ServiceStatus { online: boolean; latency_ms: number }

export interface ProxyStatus { online: boolean; uptime: number; request_count: number }

export interface SystemStatus {
  proxy:     ServiceStatus;
  storage:   ServiceStatus;
  tls:       ServiceStatus;
  dns:       ServiceStatus;
  optimizer: ServiceStatus;
}

interface GrpcClient { health: () => Promise<{ online: boolean; latency_ms: number }> }

/** syncDomains를 지원하는 gRPC 클라이언트 (tls-service, dns-service) */
interface DomainEntry { host: string; origin: string }
interface SyncableGrpcClient extends GrpcClient {
  syncDomains: (domains: DomainEntry[]) => Promise<{ success: boolean }>;
}

interface Deps {
  proxyAdminUrl:   string;
  storageClient:   GrpcClient;
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
};

export class HealthMonitor {
  private proxyStatus:  ProxyStatus  = { ...OFFLINE_PROXY };
  private systemStatus: SystemStatus = { ...OFFLINE_SYSTEM };
  private proxyWasOnline = false;

  constructor(private readonly deps: Deps) {}

  /** 캐시된 proxy 상태 반환 (proxy.ts 라우트용) */
  getProxyStatus(): ProxyStatus { return this.proxyStatus; }

  /** 캐시된 전체 서비스 상태 반환 (system.ts 라우트용) */
  getSystemStatus(): SystemStatus { return this.systemStatus; }

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

    this.systemStatus = {
      proxy: { online: proxyOnline, latency_ms: proxyLatency },
      storage, tls, dns, optimizer,
    };
  }
}
