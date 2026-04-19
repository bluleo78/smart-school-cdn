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
  const { data, isLoading } = useDomainTopUrls(host, period, range, refetchIntervalMs);

  return (
    <Card data-testid="domain-top-urls">
      <CardHeader>
        <CardTitle className="text-base font-semibold">요청 상위 URL (Top 5)</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
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
