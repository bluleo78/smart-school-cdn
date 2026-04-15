/// 최근 프록시 요청 로그를 테이블로 보여주는 컴포넌트
/// 5초 간격으로 API를 폴링하여 최신 로그를 표시한다.
import { Activity } from 'lucide-react';
import { useProxyRequests } from '../../hooks/useProxyRequests';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Skeleton } from '../ui/skeleton';

/** 상태코드에 따른 배지 색상 반환
 *  2xx: 초록 (성공), 3xx: 파랑 (리다이렉트), 4xx: 노랑 (클라이언트 에러), 5xx: 빨강 (서버 에러) */
function statusColor(code: number): string {
  if (code < 300) return 'bg-success-subtle text-success';
  if (code < 400) return 'bg-info-subtle text-info';
  if (code < 500) return 'bg-warning-subtle text-warning';
  return 'bg-destructive-subtle text-destructive';
}

/** ISO 타임스탬프를 "HH:MM:SS" 형식으로 변환 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('ko-KR', { hour12: false });
}

export function RequestLogTable() {
  const { data: logs, isLoading, error } = useProxyRequests();

  // 로딩 중일 때 스켈레톤 표시
  if (isLoading) {
    return (
      <Card data-testid="request-log-loading">
        <CardHeader><CardTitle>최근 요청</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>최근 요청</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">요청 로그를 불러오지 못했습니다.</p>
        </CardContent>
      </Card>
    );
  }

  // 로그가 없을 때 안내 메시지
  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>최근 요청</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Activity size={32} className="opacity-30" />
            <p className="text-sm">요청 로그가 없습니다.</p>
            <p className="text-xs">프록시로 요청이 들어오면 여기에 실시간 표시됩니다.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>최근 요청</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시간</TableHead>
                <TableHead>메서드</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>응답시간</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={`${log.timestamp}-${log.host}-${log.url}`}>
                  <TableCell className="text-muted-foreground">{formatTime(log.timestamp)}</TableCell>
                  <TableCell className="font-mono">{log.method}</TableCell>
                  <TableCell>{log.host}</TableCell>
                  <TableCell className="font-mono max-w-xs truncate">{log.url}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(log.status_code)}`}>
                      {log.status_code}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{log.response_time_ms}ms</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
