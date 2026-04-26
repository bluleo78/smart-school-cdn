/// 도메인 통계 탭 — 최적화 절감 통계 카드 3개 (원본 용량, 최적화 용량, 절감률)
import { useDomainOptimization } from '../../../hooks/useDomainOptimization';
import { formatBytes } from '../../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

interface Props {
  host: string;
}

export function DomainOptimizationStats({ host }: Props) {
  const { data } = useDomainOptimization(host);

  /** 이 도메인의 통계 항목만 필터링 */
  const stat = data?.stats.find((s) => s.domain === host);

  const originalBytes = stat?.original_bytes ?? 0;
  const optimizedBytes = stat?.optimized_bytes ?? 0;
  /** 절감률 계산 — 원본 0이면 0% */
  const savedPct =
    originalBytes > 0
      ? Math.round(((originalBytes - optimizedBytes) / originalBytes) * 100)
      : 0;

  return (
    <div
      className="grid grid-cols-3 gap-4"
      data-testid="domain-optimization-stats"
    >
      {/* 원본 용량 */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs text-muted-foreground">원본 용량</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-semibold">{formatBytes(originalBytes)}</p>
        </CardContent>
      </Card>

      {/* 최적화 용량 */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs text-muted-foreground">최적화 용량</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-semibold">{formatBytes(optimizedBytes)}</p>
        </CardContent>
      </Card>

      {/* 절감률 */}
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-xs text-muted-foreground">절감률</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-semibold">{savedPct}%</p>
        </CardContent>
      </Card>
    </div>
  );
}
