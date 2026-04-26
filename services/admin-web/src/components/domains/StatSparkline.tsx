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

/** 증감 텍스트 (양수 초록, 음수 빨강) */
export function DeltaBadge({ delta, unit = '' }: { delta: number; unit?: string }) {
  const positive = delta >= 0;
  return (
    <span className={`text-xs font-medium ${positive ? 'text-success' : 'text-destructive'}`}>
      {positive ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}{unit}
    </span>
  );
}
