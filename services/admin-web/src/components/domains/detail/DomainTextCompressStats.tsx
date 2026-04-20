/// Phase 16-3: 텍스트 압축(brotli/gzip) 누적 통계 카드.
/// optimization_events 의 event_type='text_compress' 집계(`/api/optimization/stats`)를 사용한다.
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { formatBytes } from '../../../lib/format';

interface StatsResponse {
  total: number;
  by_decision: Array<{ decision: string; count: number; total_orig: number; total_out: number }>;
}

export function DomainTextCompressStats({ host }: { host: string }) {
  const { data, isLoading } = useQuery<StatsResponse>({
    queryKey: ['domain', host, 'text-compress-stats'],
    queryFn: async () => {
      const res = await fetch(
        `/api/optimization/stats?type=text_compress&host=${encodeURIComponent(host)}&period=30d`,
      );
      if (!res.ok) throw new Error('text_compress stats 조회 실패');
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  /** by_decision 누적 합산 — 원본/출력 바이트, 평균 절감률 산출 */
  const totalOrig = data?.by_decision.reduce((s, r) => s + r.total_orig, 0) ?? 0;
  const totalOut = data?.by_decision.reduce((s, r) => s + r.total_out, 0) ?? 0;
  const savings = totalOrig > 0 ? 1 - totalOut / totalOrig : 0;
  const brCount = data?.by_decision.find((r) => r.decision === 'compressed_br')?.count ?? 0;
  const gzipCount = data?.by_decision.find((r) => r.decision === 'compressed_gzip')?.count ?? 0;

  return (
    <Card data-testid="text-compress-stats">
      <CardHeader>
        <CardTitle className="text-base font-semibold">텍스트 압축 (30일 누적)</CardTitle>
        <p className="text-sm text-muted-foreground">Phase 15 brotli/gzip 프리컴프레스 결과</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 md:grid-cols-1">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-sm">처리 이벤트</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(brCount + gzipCount).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">br {brCount} · gzip {gzipCount}</p>
            </CardContent>
          </Card>
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-sm">원본 → 압축</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {formatBytes(totalOrig)} → {formatBytes(totalOut)}
              </p>
            </CardContent>
          </Card>
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="text-sm">평균 절감</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(savings * 100).toFixed(1)}%</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}
