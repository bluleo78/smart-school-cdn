/// 인기 콘텐츠 카드 — 히트 수 기준 Top 5 캐시 항목을 테이블로 표시
import { useCachePopular } from '../../hooks/useCachePopular';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';

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
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">캐시된 콘텐츠가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/40">
                  <th className="text-left pb-2 font-medium">도메인</th>
                  <th className="text-left pb-2 font-medium">경로</th>
                  <th className="text-right pb-2 font-medium">히트</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  // URL에서 경로 부분만 추출 (도메인 제외)
                  let path = item.url;
                  try {
                    path = new URL(item.url).pathname;
                  } catch {
                    // URL 파싱 실패 시 원본 사용
                  }
                  return (
                    <tr key={i} className="border-b border-border/20 last:border-0">
                      <td className="py-1.5 pr-2 max-w-[100px] truncate text-muted-foreground">
                        {item.domain}
                      </td>
                      <td className="py-1.5 pr-2 max-w-[160px] truncate font-mono text-xs">
                        {path}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        {item.hit_count.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
