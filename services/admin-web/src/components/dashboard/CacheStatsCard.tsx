/// BYPASS 사유 세부 카드 — BYPASS 4분류(METHOD/NOCACHE/SIZE/OTHER)를 나눠 보여주고
/// 운영자가 원인별로 정책을 튜닝할 수 있도록 돕는다. 재설계 이전엔 총 항목/용량/히트율을
/// 담았으나, 해당 지표는 EntryCount/StorageUsage/CacheHitRate 카드가 전담하므로
/// 이 슬롯은 BYPASS 상세로 재배치했다. 읽기 전용 정보만 표시한다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

export function CacheStatsCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>BYPASS 사유 세부</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>BYPASS 사유 세부</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">데이터 로드 실패</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="cache-stats-card">
      <CardHeader><CardTitle>BYPASS 사유 세부</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {/* BYPASS 4분류 카운터 */}
        <div className="grid grid-cols-2 gap-2 text-sm" data-testid="bypass-breakdown">
          <div className="flex justify-between">
            {/* METHOD → 메서드 불일치: 캐시 불가 HTTP 메서드(POST 등) */}
            <span className="text-muted-foreground">메서드 불일치</span>
            <span className="font-mono tabular-nums">{data.bypass.method.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            {/* NOCACHE → 캐시 불가: Cache-Control: no-cache/no-store 등 헤더 지시 */}
            <span className="text-muted-foreground">캐시 불가</span>
            <span className="font-mono tabular-nums">{data.bypass.nocache.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            {/* SIZE → 크기 초과: 최대 캐시 객체 크기 초과 */}
            <span className="text-muted-foreground">크기 초과</span>
            <span className="font-mono tabular-nums">{data.bypass.size.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            {/* OTHER → 기타: 위 분류에 해당하지 않는 나머지 사유 */}
            <span className="text-muted-foreground">기타</span>
            <span className="font-mono tabular-nums">{data.bypass.other.toLocaleString()}</span>
          </div>
        </div>
        {/* 총 BYPASS */}
        <div>
          <p className="text-lg font-semibold leading-tight tabular-nums">
            {data.bypass.total.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">총 BYPASS</p>
        </div>
      </CardContent>
    </Card>
  );
}
