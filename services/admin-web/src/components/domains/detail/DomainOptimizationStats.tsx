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
  /**
   * 절감률 계산 — 원본 0이면 0%.
   * optimized > original (이미 압축된 자산을 재변환해 더 커진 경우)이면 raw 값은 음수가 되는데,
   * "절감률" 라벨 의미상 음수는 모순이므로 카드 본문은 0%로 클램프하고,
   * 비정상 케이스는 별도 "+X% 증가" 보조 라인으로 명시한다 (#244).
   */
  const rawSavedPct =
    originalBytes > 0
      ? Math.round(((originalBytes - optimizedBytes) / originalBytes) * 100)
      : 0;
  const savedPct = Math.max(0, rawSavedPct);
  /** 용량이 오히려 증가한 비정상 케이스 — 보조 라인 표시 여부 및 증가율(양수) */
  const increasedPct = rawSavedPct < 0 ? -rawSavedPct : 0;

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
          <p className="text-lg font-semibold" data-testid="domain-optimization-saved-pct">
            {savedPct}%
          </p>
          {/* 용량 증가 보조 라인 — destructive 색상으로 비정상 케이스 명시 (#244) */}
          {increasedPct > 0 && (
            <p
              className="mt-1 text-xs text-destructive"
              data-testid="domain-optimization-increase-note"
            >
              +{increasedPct}% 증가
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
