/// 기간 토글 + 커스텀 date range 입력. Stats/Logs 탭에서 재사용.
import { useState } from 'react';
import { Button } from '../../ui/button';

export type Period = '1h' | '24h' | '7d' | '30d' | 'custom';

export interface PeriodValue {
  period: Period;
  /** custom 일 때만 유효. 초 단위 unix timestamp */
  from?: number;
  to?: number;
}

interface Props {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
}

const PRESETS: { key: Exclude<Period, 'custom'>; label: string }[] = [
  { key: '1h',  label: '1시간' },
  { key: '24h', label: '24시간' },
  { key: '7d',  label: '7일' },
  { key: '30d', label: '30일' },
];

/** yyyy-mm-dd 문자열을 해당 날짜 00:00 local 의 unix(초)로 */
function dateStrToEpoch(s: string, endOfDay: boolean): number {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return Math.floor(dt.getTime() / 1000);
}

function epochToDateStr(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function PeriodSelector({ value, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(value.period === 'custom');

  function selectPreset(p: Exclude<Period, 'custom'>) {
    setCustomOpen(false);
    onChange({ period: p });
  }

  function applyCustom(fromStr: string, toStr: string) {
    const from = dateStrToEpoch(fromStr, false);
    const to = dateStrToEpoch(toStr, true);
    if (to <= from) return;
    onChange({ period: 'custom', from, to });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="period-selector">
      {PRESETS.map(({ key, label }) => (
        <Button
          key={key}
          variant={value.period === key ? 'default' : 'outline'}
          onClick={() => selectPreset(key)}
          size="sm"
          data-testid={`period-${key}`}
          aria-pressed={value.period === key}
        >
          {label}
        </Button>
      ))}
      <Button
        variant={value.period === 'custom' ? 'default' : 'outline'}
        onClick={() => setCustomOpen(true)}
        size="sm"
        data-testid="period-custom"
        aria-pressed={value.period === 'custom'}
      >
        커스텀
      </Button>
      {customOpen && (
        <div className="flex items-center gap-2" data-testid="period-custom-range">
          <input
            type="date"
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            defaultValue={value.from ? epochToDateStr(value.from) : ''}
            onChange={(e) => {
              const toStr = value.to ? epochToDateStr(value.to) : e.target.value;
              applyCustom(e.target.value, toStr);
            }}
            data-testid="period-custom-from"
          />
          <span className="text-xs text-muted-foreground">~</span>
          <input
            type="date"
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            defaultValue={value.to ? epochToDateStr(value.to) : ''}
            onChange={(e) => {
              const fromStr = value.from ? epochToDateStr(value.from) : e.target.value;
              applyCustom(fromStr, e.target.value);
            }}
            data-testid="period-custom-to"
          />
        </div>
      )}
    </div>
  );
}
