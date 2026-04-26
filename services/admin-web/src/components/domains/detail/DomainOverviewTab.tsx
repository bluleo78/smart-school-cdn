/// 도메인 개요 탭 — 기본정보 → 요약카드(오늘) → Quick Actions.
import type { Domain } from '../../../api/domain-types';
import { useDomainStats } from '../../../hooks/useDomainStats';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { formatBytes } from '../../../lib/format';
import { DomainInfoCards } from './DomainInfoCards';
import { DomainQuickActions } from './DomainQuickActions';
import { BarSparkline, DeltaBadge } from '../StatSparkline';

interface Props {
  domain: Domain;
}

/** 요약 카드 — 오늘 기준 4개(요청/히트율/대역폭/응답시간) */
function SummaryCards({ host }: { host: string }) {
  const { data, isLoading } = useDomainStats(host, '24h');
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader><CardTitle><Skeleton className="h-4 w-24" /></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  const s = data?.summary;
  const ts = data?.timeseries;
  const hourlyRequests = ts ? ts.hits.map((h, i) => h + (ts.misses[i] ?? 0)) : Array(24).fill(0);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4" data-testid="domain-stat-cards">
      <Card data-testid="stat-card-requests">
        <CardHeader><CardTitle>오늘 요청</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{(s?.totalRequests ?? 0).toLocaleString()}</p>
              <DeltaBadge delta={s?.requestsDelta ?? 0} unit="%" />
            </div>
            <BarSparkline values={hourlyRequests} />
          </div>
        </CardContent>
      </Card>
      <Card data-testid="stat-card-cache-hit">
        <CardHeader><CardTitle>캐시 히트율</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{((s?.cacheHitRate ?? 0) * 100).toFixed(1)}%</p>
              <DeltaBadge delta={s?.cacheHitRateDelta ?? 0} unit="%" />
            </div>
            <BarSparkline values={ts?.hits ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>
      <Card data-testid="stat-card-bandwidth">
        <CardHeader><CardTitle>오늘 대역폭</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{formatBytes(s?.bandwidth ?? 0)}</p>
              <span className="text-xs text-muted-foreground">누적</span>
            </div>
            <BarSparkline values={ts?.bandwidth ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>
      <Card data-testid="stat-card-response-time">
        <CardHeader><CardTitle>평균 응답시간</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{(s?.avgResponseTime ?? 0).toFixed(0)}ms</p>
              <DeltaBadge delta={-(s?.responseTimeDelta ?? 0)} unit="ms" />
            </div>
            <BarSparkline values={ts?.responseTime ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DomainOverviewTab({ domain }: Props) {
  return (
    <div className="space-y-6" data-testid="domain-overview-tab">
      <DomainInfoCards domain={domain} />
      <SummaryCards host={domain.host} />
      <DomainQuickActions domain={domain} />
    </div>
  );
}
