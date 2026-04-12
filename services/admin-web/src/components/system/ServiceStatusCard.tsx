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
    <Card>
      <CardContent className="pt-6">
        {/* 서비스 이름 */}
        <p className="text-sm font-medium text-muted-foreground">{name}</p>
        {/* 온라인/오프라인 배지 */}
        {online ? (
          <Badge variant="outline" className="mt-2 border-green-500 text-green-700">
            온라인
          </Badge>
        ) : (
          <Badge variant="destructive" className="mt-2">
            오프라인
          </Badge>
        )}
        {/* 응답 시간: 온라인이면 ms 표시, 오프라인이면 대시 */}
        <p className="mt-2 text-2xl font-bold">
          {online ? `${latency_ms}ms` : '—'}
        </p>
      </CardContent>
    </Card>
  );
}
