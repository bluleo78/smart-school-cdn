/// 프록시 상태 카드 — 온라인/오프라인 배지, 업타임, 총 요청 수
import { useProxyStatus } from '../../hooks/useProxyStatus';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardTitle, CardHeader } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { formatUptime } from '../../lib/format';

export function ProxyStatusCard() {
  const { data, isLoading, error } = useProxyStatus();

  if (isLoading) {
    return (
      <Card variant="glass" data-testid="proxy-status-loading">
        <CardHeader><CardTitle>프록시 상태</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="glass">
        <CardHeader><CardTitle>프록시 상태</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">연결 실패</p>
        </CardContent>
      </Card>
    );
  }

  const isOnline = data?.online ?? false;

  return (
    <Card variant="glass">
      <CardHeader><CardTitle>프록시 상태</CardTitle></CardHeader>
      <CardContent>
        <Badge variant={isOnline ? 'success' : 'destructive'}>
          {isOnline ? '온라인' : '오프라인'}
        </Badge>
        <p data-testid="proxy-uptime" className="text-xl font-bold mt-3 leading-tight">{formatUptime(data?.uptime ?? 0)}</p>
        <p className="text-xs text-muted-foreground mt-1">
          총 요청 {(data?.request_count ?? 0).toLocaleString()}건
        </p>
      </CardContent>
    </Card>
  );
}
