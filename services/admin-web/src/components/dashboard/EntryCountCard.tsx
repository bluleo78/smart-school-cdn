/// 캐시 항목 수 카드 — 재설계 후 `disk.entry_count`에서 값을 읽는다.
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

export function EntryCountCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>캐시 항목</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-8 w-16" /></CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>캐시 항목</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass" data-testid="entry-count-card">
      <CardHeader><CardTitle>캐시 항목</CardTitle></CardHeader>
      <CardContent>
        <p
          className="text-3xl font-bold tabular-nums"
          data-testid="dashboard-entry-count"
        >
          {data.disk.entry_count.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground mt-1">저장된 URL</p>
      </CardContent>
    </Card>
  );
}
