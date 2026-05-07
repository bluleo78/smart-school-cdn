/// 도메인 통계 공통 컴포넌트 — BarSparkline, DeltaBadge
/// DomainSummaryCards, DomainOverviewTab에서 공유

/** 바 스파크라인 — 높이 36px(h-9), 부모 폭에 자동 스케일 (반응형)
 *  - 회귀 #271 3차: 카드 폭이 좁아지면 절대 117px(24바×5px+gap)이 카드 경계를 초과 → SVG viewBox 기반으로 전환.
 *    부모가 좁아지면 bar 폭/gap도 같은 비율로 축소된다 (preserveAspectRatio="none"으로 X축만 자유 스케일,
 *    Y축은 36px 고정 표현 위해 height fixed). flex 자식으로 들어갈 때 min-w-0이 효과를 발휘하도록
 *    block + w-full로 둠.
 *  - baseline floor 12px — 평탄/0 데이터에서도 차트 영역(36)의 1/3 이상 표시 (#258).
 */
export function BarSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const n = values.length;
  // viewBox 좌표계 — bar 5 + gap 2 = 7 단위, 마지막 bar 뒤 gap 제외
  const BAR = 5;
  const GAP = 2;
  const VB_W = n * BAR + Math.max(0, n - 1) * GAP;
  const VB_H = 36;
  return (
    <svg
      // 카드 폭이 좁아지면 X축만 자동 스케일 (Y축은 height로 36px 고정)
      // min-w-0: flex 자식에서 컨테이너 폭 제약을 받도록
      className="block w-full h-9 min-w-0"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {values.map((v, i) => {
        // 최소 12px floor — 평탄 데이터가 4px로 죽어 보이지 않도록 (#258)
        const h = Math.max(12, (v / max) * VB_H);
        return (
          <rect
            key={i}
            x={i * (BAR + GAP)}
            y={VB_H - h}
            width={BAR}
            height={h}
            rx={1}
            className="fill-primary"
            opacity={0.7}
          />
        );
      })}
    </svg>
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
