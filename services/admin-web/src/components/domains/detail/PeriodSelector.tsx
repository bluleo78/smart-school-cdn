/// 기간 토글 + 커스텀 date range 입력. Stats/Logs 탭에서 재사용.
import { useState } from 'react';
import { Button } from '../../ui/button';
// shadcn Input 컴포넌트를 사용해 포커스 링·디자인 일관성 확보 (raw <input> 대체)
import { Input } from '../../ui/input';
// destructive 텍스트 색상 — 역방향 날짜 에러 표시에 사용
import { cn } from '../../../lib/utils';

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
  // 역방향 날짜 범위 입력 시 표시할 에러 메시지. null이면 에러 없음.
  const [customError, setCustomError] = useState<string | null>(null);

  function selectPreset(p: Exclude<Period, 'custom'>) {
    setCustomOpen(false);
    // 프리셋 선택 시 커스텀 에러 초기화 — 이전 역방향 에러가 잔존하지 않도록
    setCustomError(null);
    onChange({ period: p });
  }

  function applyCustom(fromStr: string, toStr: string) {
    const from = dateStrToEpoch(fromStr, false);
    const to = dateStrToEpoch(toStr, true);
    if (to <= from) {
      // 역방향 범위: 시각적 에러 표시 후 onChange 호출 없이 종료
      setCustomError('종료일은 시작일 이후여야 합니다.');
      return;
    }
    // 유효 범위 진입 시 에러 초기화
    setCustomError(null);
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
        // 커스텀 날짜 범위 입력: <Input> 컴포넌트로 포커스 링·디자인 일관성 확보
        <div className="flex flex-col gap-1" data-testid="period-custom-range">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className={cn('h-8 w-36 px-2 text-xs', customError && 'border-destructive focus-visible:ring-destructive')}
              defaultValue={value.from ? epochToDateStr(value.from) : ''}
              onChange={(e) => {
                // to가 없으면 오늘 날짜를 기본값으로 사용 — from만 입력해도 오늘까지 범위 적용
                const today = epochToDateStr(Math.floor(Date.now() / 1000));
                const toStr = value.to ? epochToDateStr(value.to) : today;
                applyCustom(e.target.value, toStr);
              }}
              data-testid="period-custom-from"
            />
            <span className="text-xs text-muted-foreground">~</span>
            <Input
              type="date"
              className={cn('h-8 w-36 px-2 text-xs', customError && 'border-destructive focus-visible:ring-destructive')}
              defaultValue={value.to ? epochToDateStr(value.to) : ''}
              onChange={(e) => {
                const fromStr = value.from ? epochToDateStr(value.from) : e.target.value;
                applyCustom(fromStr, e.target.value);
              }}
              data-testid="period-custom-to"
            />
          </div>
          {/* 역방향 날짜 범위 에러 메시지 — 입력 필드 아래 표시 */}
          {customError && (
            <p className="text-xs text-destructive" data-testid="period-custom-error">
              {customError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
