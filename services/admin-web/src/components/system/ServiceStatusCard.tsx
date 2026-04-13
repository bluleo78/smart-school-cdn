/** 마이크로서비스 상태 카드 — 온라인/오프라인 + 응답 시간 표시 */
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';

interface Props {
  name: string;
  online: boolean;
  latency_ms: number;
}

/** 서비스 이름, 온라인 여부, 응답 지연(ms)을 카드 형태로 렌더링 */
export function ServiceStatusCard({ name, online, latency_ms }: Props) {
  return (
    <Card data-testid="service-status-card">
      <CardContent className="pt-5 pb-5">
        {/* 서비스 이름 + 상태 도트 */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">{name}</p>
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-green-500' : 'bg-destructive'}`}
          />
        </div>
        {/* 온라인/오프라인 배지 */}
        {online ? (
          <Badge data-testid="service-status-badge" variant="outline" className="border-green-500 text-green-700 text-xs">
            온라인
          </Badge>
        ) : (
          <Badge data-testid="service-status-badge" variant="destructive" className="text-xs">
            오프라인
          </Badge>
        )}
        {/* 응답 시간: 온라인이면 ms 표시, 오프라인이면 대시 */}
        <p data-testid="service-status-latency" className="mt-3 text-xl font-bold">
          {online ? `${latency_ms}ms` : '—'}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">응답시간</p>
      </CardContent>
    </Card>
  );
}
