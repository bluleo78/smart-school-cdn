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
      <Card data-testid="proxy-status-loading">
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
      <Card>
        <CardHeader><CardTitle>프록시 상태</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">연결 실패</p>
        </CardContent>
      </Card>
    );
  }

  const isOnline = data?.online ?? false;

  return (
    <Card>
      <CardHeader><CardTitle>프록시 상태</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Badge variant={isOnline ? 'outline' : 'destructive'}>
          {isOnline ? '온라인' : '오프라인'}
        </Badge>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">업타임</p>
            <p className="text-lg font-semibold">{formatUptime(data?.uptime ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">총 요청 수</p>
            <p className="text-lg font-semibold">{(data?.request_count ?? 0).toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
