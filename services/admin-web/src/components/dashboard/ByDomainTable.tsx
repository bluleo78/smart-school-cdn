/// 도메인별 캐시 지표 표 — 재설계 §7.3 신규 요구사항.
/// 각 row 클릭 시 `/domains/:host` 상세 페이지로 이동해 드릴다운을 지원한다.
import { useNavigate } from 'react-router';
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function ByDomainTable() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>도메인별 캐시 지표</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-40 w-full" /></CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>도메인별 캐시 지표</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive">연결 실패</p></CardContent>
      </Card>
    );
  }

  if (data.by_domain.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>도메인별 캐시 지표</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">도메인 데이터가 없습니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>도메인별 캐시 지표</CardTitle></CardHeader>
      <CardContent className="px-0">
        <Table data-testid="by-domain-table">
          <TableHeader>
            <TableRow>
              <TableHead>Host</TableHead>
              <TableHead className="text-right">요청</TableHead>
              <TableHead className="text-right">L1 히트율</TableHead>
              <TableHead className="text-right">엣지 히트율</TableHead>
              <TableHead className="text-right">BYPASS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.by_domain.map((d) => (
              <TableRow
                key={d.host}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => navigate(`/domains/${encodeURIComponent(d.host)}`)}
                data-testid={`by-domain-row-${d.host}`}
              >
                <TableCell className="font-mono">{d.host}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.requests.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtPct(d.l1_hit_rate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtPct(d.edge_hit_rate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.bypass_total.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
