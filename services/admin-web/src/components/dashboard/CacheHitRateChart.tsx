/// 히트율 추이 차트 — Recharts LineChart, 최근 1시간 (매분 스냅샷)
import { useCacheStats } from '../../hooks/useCacheStats';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export function CacheHitRateChart() {
  const { data, isLoading, error } = useCacheStats();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>캐시 히트율 추이</CardTitle></CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>캐시 히트율 추이</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">연결 실패</p>
        </CardContent>
      </Card>
    );
  }

  const history = data?.hit_rate_history ?? [];

  const chartData =
    history.length > 0
      ? history.map((snap) => ({
          time: new Date(snap.timestamp).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          hitRate: parseFloat(snap.hit_rate.toFixed(1)),
        }))
      : [{ time: '지금', hitRate: parseFloat((data?.hit_rate ?? 0).toFixed(1)) }];

  return (
    <Card>
      <CardHeader><CardTitle>캐시 히트율 추이</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
            <Tooltip formatter={(v: unknown) => [`${v as number}%`, '히트율']} />
            <Line
              type="monotone"
              dataKey="hitRate"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
