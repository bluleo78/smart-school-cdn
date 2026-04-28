/// 도메인 통계 탭 — 최적화 절감 통계 카드 3개 (원본 용량, 최적화 용량, 절감률)
import { useDomainOptimization } from '../../../hooks/useDomainOptimization';
import { formatBytes } from '../../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';

interface Props {
  host: string;
}

export function DomainOptimizationStats({ host }: Props) {
  // isLoading·isError를 함께 destructure하여 로딩·에러 상태를 명시적으로 처리한다 (#153)
  const { data, isLoading, isError } = useDomainOptimization(host);

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4" data-testid="domain-optimization-stats">
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="py-6">
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // API 호출 실패 시 에러 메시지 표시 — DomainTopUrlsCard (#148) 패턴 동일 적용
  if (isError) {
    return (
      <div className="grid grid-cols-3 gap-4" data-testid="domain-optimization-stats">
        <Card className="col-span-3">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">최적화 통계를 불러올 수 없습니다</p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
