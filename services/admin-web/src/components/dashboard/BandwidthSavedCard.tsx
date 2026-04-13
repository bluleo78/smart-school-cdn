/// 대역폭 절감 카드
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { formatBytes } from '../../lib/format';

export function BandwidthSavedCard() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>대역폭 절감</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-8 w-24" /></CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>대역폭 절감</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  /// 도메인별 캐시 크기 합산을 대역폭 절감 추정치로 사용한다
  const saved = data?.by_domain?.reduce((acc, d) => acc + d.size_bytes, 0) ?? 0;

  return (
    <Card>
      <CardHeader><CardTitle>대역폭 절감</CardTitle></CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{formatBytes(saved)}</p>
        <p className="text-xs text-muted-foreground mt-1">캐시 HIT으로 절감된 트래픽</p>
      </CardContent>
    </Card>
  );
}
