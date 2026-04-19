/// 자동 갱신 간격 드롭다운. Logs 탭에서 사용.
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../../ui/select';

/** 0 = Off, 그 외는 refetchInterval(ms) */
export type RefreshIntervalMs = 0 | 10_000 | 30_000 | 60_000 | 300_000;

const OPTIONS: { value: RefreshIntervalMs; label: string }[] = [
  { value: 0,       label: 'Off' },
  { value: 10_000,  label: '10초' },
  { value: 30_000,  label: '30초' },
  { value: 60_000,  label: '1분' },
  { value: 300_000, label: '5분' },
];

interface Props {
  value: RefreshIntervalMs;
  onChange: (v: RefreshIntervalMs) => void;
}

export function RefreshIntervalSelect({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-2" data-testid="refresh-interval-select">
      {value > 0 && <span className="h-2 w-2 rounded-full bg-success" aria-hidden />}
      <span className="text-xs text-muted-foreground">갱신</span>
      <Select value={String(value)} onValueChange={(s) => onChange(Number(s) as RefreshIntervalMs)}>
        <SelectTrigger className="h-8 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
