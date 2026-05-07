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
  // isError: API 요청 실패 여부 — isError가 true이면 0 fallback 대신 에러 메시지 표시 (#147)
  const { data, isLoading, isError } = useDomainStats(host, '24h');

  // API 실패 시 0으로 오해하지 않도록 에러 상태를 명시적으로 표시한다
  if (isError) {
    return (
      <p className="text-sm text-destructive" data-testid="domain-stat-cards-error">
        통계를 불러오지 못했습니다.
      </p>
    );
  }

  if (isLoading) {
    // 4-카드 그리드 — iPad portrait(810px)/landscape(1180px)에서 4-col로 좁아지면
    // BarSparkline(약 117px)이 좌측 큰 숫자와 함께 카드 폭을 초과하므로
    // lg(1024px)부터 4-col 펼침. 그 미만은 sm(640px)부터 2-col 유지 (#271)
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="overflow-hidden">
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
  // 4-카드 그리드 — md(768px) 4-col 강제 시 BarSparkline이 카드 경계 밖으로 17~96px 오버플로우.
  // lg(1024px)부터 4-col로 펼치고, 각 Card에 overflow-hidden을 두어 스파크라인 클리핑 (#271,
  // 선례: DomainSummaryCards의 #71/#129 가드)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="domain-stat-cards">
      <Card data-testid="stat-card-requests" className="overflow-hidden">
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
      <Card data-testid="stat-card-cache-hit" className="overflow-hidden">
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
      <Card data-testid="stat-card-bandwidth" className="overflow-hidden">
        <CardHeader><CardTitle>오늘 대역폭</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              {/* whitespace-nowrap: formatBytes 결과 "688.4 MB"의 number+space+unit이
                  4-카드 grid의 좁은 좌측 컬럼에서 공백 wrap되어 2줄로 분리되는 문제 방지 (#262).
                  DomainSummaryCards의 동일 카드와 패턴 통일. */}
              <p className="text-3xl font-bold whitespace-nowrap">{formatBytes(s?.bandwidth ?? 0)}</p>
              <span className="text-xs text-muted-foreground">누적</span>
            </div>
            <BarSparkline values={ts?.bandwidth ?? Array(24).fill(0)} />
          </div>
        </CardContent>
      </Card>
      <Card data-testid="stat-card-response-time" className="overflow-hidden">
        <CardHeader><CardTitle>평균 응답시간</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold">{(s?.avgResponseTime ?? 0).toFixed(0)}ms</p>
              {/* responseTimeDelta는 백엔드에서 백분율(%)로 산출됨 (domain-stats-repo.ts getDelta).
                  다른 카드(요청·캐시 히트율)와 단위 일관성을 맞추기 위해 '%'로 표시한다.
                  부호 반전(-)은 응답시간 감소를 "개선(녹색)"으로 표시하기 위함. */}
              <DeltaBadge delta={-(s?.responseTimeDelta ?? 0)} unit="%" />
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
