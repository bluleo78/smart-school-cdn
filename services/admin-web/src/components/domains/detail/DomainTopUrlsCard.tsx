/// Logs 탭 상단의 Top N URL 카드. 기간/범위/갱신주기는 부모에서 주입.
import { useDomainTopUrls } from '../../../hooks/useDomainTopUrls';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import type { StatsPeriod } from '../../../api/domains';

interface Props {
  host: string;
  period: StatsPeriod;
  range?: { from: number; to: number };
  refetchIntervalMs: number | false;
}

export function DomainTopUrlsCard({ host, period, range, refetchIntervalMs }: Props) {
  // error를 함께 destructure하여 API 실패 시 에러 상태 표시 (#148)
  const { data, isLoading, error } = useDomainTopUrls(host, period, range, refetchIntervalMs);

  return (
    <Card data-testid="domain-top-urls">
      <CardHeader>
        <CardTitle className="text-base font-semibold">요청 상위 URL (Top 5)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          // API 호출 실패 시 에러 메시지 표시 — DomainLogTable 패턴 동일 적용
          <p className="text-sm text-destructive">상위 URL을 불러올 수 없습니다</p>
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">데이터 없음</p>
        ) : (
          <ul className="space-y-2">
            {data.map((u) => (
              <li key={u.path} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-mono text-xs" title={u.path}>{u.path}</span>
                <span className="tabular-nums text-muted-foreground">{u.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
