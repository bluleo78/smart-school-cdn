/// 도메인별 캐시 지표 표 — 재설계 §7.3 신규 요구사항.
/// 각 row 클릭 시 `/domains/:host` 상세 페이지로 이동해 드릴다운을 지원한다.
/// 키보드 접근성: tabIndex/role/onKeyDown 추가로 Tab 포커스 및 Enter/Space 활성화 지원 (#108)
import { useNavigate } from 'react-router';
import type { KeyboardEvent } from 'react';
import { Globe } from 'lucide-react';
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
          {/* 빈 상태 — 아이콘 + 제목 + 설명 3요소로 사용자가 다음 행동을 알 수 있도록 안내 (Design checklist §2.5) */}
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Globe className="h-8 w-8 opacity-50" />
            <p className="text-sm font-medium">도메인 데이터가 없습니다</p>
            <p className="text-xs">도메인을 추가하면 캐시 지표가 표시됩니다</p>
          </div>
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
              <TableHead>호스트</TableHead>
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
                className="cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                onClick={() => navigate(`/domains/${encodeURIComponent(d.host)}`)}
                // 키보드 접근성: 포커스 가능하게 하고 Enter/Space 키로 클릭과 동일한 탐색 수행 (WCAG 2.1.1)
                tabIndex={0}
                role="link"
                aria-label={`${d.host} 도메인 상세 보기`}
                onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    // Space 키의 기본 동작(페이지 스크롤)을 막고 탐색 실행
                    e.preventDefault();
                    navigate(`/domains/${encodeURIComponent(d.host)}`);
                  }
                }}
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
