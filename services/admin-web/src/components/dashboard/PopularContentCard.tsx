/// 인기 콘텐츠 카드 — 히트 수 기준 Top 5 캐시 항목을 테이블로 표시
/// shadcn Table 컴포넌트 사용으로 ByDomainTable과 헤더·패딩·border 스타일 일관성 유지
import { useCachePopular } from '../../hooks/useCachePopular';
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

export function PopularContentCard() {
  const { data, isLoading, error } = useCachePopular();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>인기 콘텐츠 Top 5</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>인기 콘텐츠 Top 5</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">데이터 로드 실패</p>
        </CardContent>
      </Card>
    );
  }

  const items = (data ?? []).slice(0, 5);

  return (
    <Card>
      <CardHeader><CardTitle>인기 콘텐츠 Top 5</CardTitle></CardHeader>
      <CardContent className="px-0">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4">캐시된 콘텐츠가 없습니다</p>
        ) : (
          // shadcn Table 컴포넌트로 교체 — ByDomainTable과 동일한 헤더·패딩·border 스타일 적용
          <Table data-testid="popular-content-table">
            <TableHeader>
              <TableRow>
                <TableHead>도메인</TableHead>
                <TableHead>경로</TableHead>
                <TableHead className="text-right">히트</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => {
                // URL에서 경로 부분만 추출 (도메인 제외)
                let path = item.url;
                try {
                  path = new URL(item.url).pathname;
                } catch {
                  // URL 파싱 실패 시 원본 사용
                }
                return (
                  <TableRow key={i}>
                    <TableCell className="max-w-[100px] truncate text-muted-foreground">
                      {item.domain}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate font-mono text-xs">
                      {path}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {item.hit_count.toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
