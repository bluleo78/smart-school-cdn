/// 히트율 추이 차트 — Recharts LineChart, 최근 1시간 (매분 스냅샷)
import { useCacheStats } from '../../hooks/useCacheStats';
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
  const { data, isLoading } = useCacheStats();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 h-48">
        <div className="animate-pulse h-full bg-gray-100 rounded" />
      </div>
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
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-4">캐시 히트율 추이</h3>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
          <Tooltip formatter={(v: unknown) => [`${v as number}%`, '히트율']} />
          <Line
            type="monotone"
            dataKey="hitRate"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
