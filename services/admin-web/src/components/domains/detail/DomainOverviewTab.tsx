/// 도메인 개요 탭 — 기본 정보 + 요약 통계 + 캐시 성능 + 빠른 액션
import { useState } from 'react';
import type { Domain } from '../../../api/domain-types';
import { useDomainStats } from '../../../hooks/useDomainStats';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { formatBytes } from '../../../lib/format';
import { DomainInfoCards } from './DomainInfoCards';
import { DomainQuickActions } from './DomainQuickActions';
import { BarSparkline, DeltaBadge } from '../StatSparkline';
import { DomainCacheCards } from './DomainCacheCards';
import { DomainStackedChart } from './DomainStackedChart';
import type { CacheSeriesRange } from '../../../api/cache';

interface Props {
  domain: Domain;
}

/** 요약 통계 카드 4개 (오늘 고정) */
function SummaryCards({ host }: { host: string }) {
  const { data, isLoading } = useDomainStats(host, '24h');

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} variant="glass">
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

  /** timeseries hit+miss 합산으로 시간별 요청 배열 생성 */
  const hourlyRequests = ts
    ? ts.hits.map((h, i) => h + (ts.misses[i] ?? 0))
    : Array(24).fill(0);

  return (
    <div className="grid grid-cols-4 gap-4" data-testid="domain-stat-cards">
      {/* 오늘 요청 */}
      <Card variant="glass" data-testid="stat-card-requests">
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

      {/* 캐시 히트율 */}
      <Card variant="glass" data-testid="stat-card-cache-hit">
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

      {/* 대역폭 */}
      <Card variant="glass" data-testid="stat-card-bandwidth">
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

      {/* 평균 응답시간 */}
      <Card variant="glass" data-testid="stat-card-response-time">
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

/** 캐시 성능 섹션 — L1/엣지/BYPASS + 스택 차트가 1h/24h 토글을 공유 */
function CachePerformanceSection({ host }: { host: string }) {
  const [range, setRange] = useState<CacheSeriesRange>('1h');

  return (
    <Card data-testid="domain-cache-performance">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>캐시 성능</CardTitle>
        <div className="flex gap-2">
          <Button
            variant={range === '1h' ? 'default' : 'outline'}
            onClick={() => setRange('1h')}
            className="px-3 py-1 text-xs"
            data-testid="domain-cache-range-1h"
          >
            1시간
          </Button>
          <Button
            variant={range === '24h' ? 'default' : 'outline'}
            onClick={() => setRange('24h')}
            className="px-3 py-1 text-xs"
            data-testid="domain-cache-range-24h"
          >
            24시간
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DomainCacheCards host={host} range={range} />
        <DomainStackedChart host={host} range={range} />
      </CardContent>
    </Card>
  );
}

export function DomainOverviewTab({ domain }: Props) {
  return (
    <div className="space-y-6" data-testid="domain-overview-tab">
      {/* 기본 정보 + 동기화 상태 */}
      <DomainInfoCards domain={domain} />

      {/* 요약 통계 카드 (오늘 고정) */}
      <SummaryCards host={domain.host} />

      {/* 캐시 성능 — L1/엣지/BYPASS + 스택 차트 (1h/24h 공유 토글) */}
      <CachePerformanceSection host={domain.host} />

      {/* 빠른 액션 */}
      <DomainQuickActions domain={domain} />
    </div>
  );
}
