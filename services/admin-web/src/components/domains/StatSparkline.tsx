/// 도메인 통계 공통 컴포넌트 — BarSparkline, DeltaBadge
/// DomainSummaryCards, DomainOverviewTab에서 공유

/** 바 스파크라인 — 높이 36px, 바 너비 5px */
export function BarSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-9">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-[5px] rounded-sm bg-primary opacity-70"
          style={{ height: `${Math.max(4, (v / max) * 36)}px` }}
        />
      ))}
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
