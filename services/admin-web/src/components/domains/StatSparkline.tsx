/// 도메인 통계 공통 컴포넌트 — BarSparkline, DeltaBadge
/// DomainSummaryCards, DomainOverviewTab에서 공유

/** 바 스파크라인 — 높이 36px, 바 너비 5px
 *  - 데이터가 평탄/0이어도 차트 영역의 1/3 이상 차지하도록 baseline floor 적용 (#258)
 *    카드 2(요청)와 카드 3·4(히트율/대역폭)의 시각 무게가 데이터 크기와 무관하게
 *    비슷하게 보이도록, 정규화 분모는 max(observedMax, 1)로 두되 바 자체의 최소 높이를
 *    12px로 올린다 — 차트 영역 36px의 약 1/3.
 */
export function BarSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  // 순수 장식 요소 — 카드 텍스트가 실제 수치를 제공하므로 AT에서 숨긴다
  return (
    <div className="flex items-end gap-0.5 h-9" aria-hidden="true">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-[5px] rounded-sm bg-primary opacity-70"
          // 최소 12px floor — 평탄 데이터가 4px로 죽어 보이지 않도록 (#258)
          style={{ height: `${Math.max(12, (v / max) * 36)}px` }}
        />
      ))}
    </div>
  );
}

/** 활성/비활성 비율 게이지 — 카드 1(전체 도메인)에서 다른 카드들의 스파크라인 슬롯 자리에
 *  같은 시각 무게로 들어가는 미니 차트. 별도 trend 데이터 없이 현재 enabled/disabled
 *  카운트만으로 그릴 수 있다 (#258).
 *
 *  - 높이 36px(h-9)로 BarSparkline과 동일 — 카드 2·3·4와 시각 무게 정렬
 *  - 활성/비활성 비율을 가로 누적 막대(stacked bar)로 표현
 *  - total === 0 (도메인 없음)이면 회색 baseline 바 한 줄 표시
 */
export function EnabledDisabledGauge({
  enabled,
  disabled,
}: {
  enabled: number;
  disabled: number;
}) {
  const total = enabled + disabled;
  const enabledPct = total > 0 ? (enabled / total) * 100 : 0;
  const disabledPct = total > 0 ? (disabled / total) * 100 : 0;
  return (
    <div
      className="h-9 flex items-end"
      aria-hidden="true"
      data-testid="domain-enabled-gauge"
    >
      {/* 12px 두께 누적 바 — BarSparkline 막대 floor(12px)와 시각 무게 일치 */}
      <div className="w-full h-3 rounded-sm overflow-hidden bg-muted flex">
        {total === 0 ? (
          // 도메인 0건일 때는 muted 회색 baseline 그대로 노출
          <div className="w-full h-full" />
        ) : (
          <>
            <div
              className="h-full bg-primary opacity-70"
              style={{ width: `${enabledPct}%` }}
            />
            <div
              className="h-full bg-muted-foreground/30"
              style={{ width: `${disabledPct}%` }}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** 증감 텍스트 (양수 초록, 음수 빨강, 0 중립)
 *  delta === 0 이면 화살표 없이 "— 0.0" + 중립 색상으로 표시.
 *  delta >= 0 조건은 0도 양수 취급하여 ↑ 오표시 문제가 있어 분기 추가. */
export function DeltaBadge({ delta, unit = '' }: { delta: number; unit?: string }) {
  // delta가 정확히 0이면 변화 없음 — 중립 표시
  if (delta === 0) {
    return (
      <span className="text-xs font-medium text-muted-foreground">
        — 0.0{unit}
      </span>
    );
  }
  const positive = delta > 0;
  return (
    <span className={`text-xs font-medium ${positive ? 'text-success' : 'text-destructive'}`}>
      {positive ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}{unit}
    </span>
  );
}
