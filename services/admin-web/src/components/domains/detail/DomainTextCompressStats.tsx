/// Phase 16-3: 텍스트 압축(brotli/gzip) 누적 통계 카드.
/// optimization_events 의 event_type='text_compress' 집계(`/api/optimization/stats`)를 사용한다.
/// period props를 받아 PeriodSelector 선택 기간과 연동한다 (이슈 #53 수정).
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { formatBytes } from '../../../lib/format';

interface StatsResponse {
  total: number;
  by_decision: Array<{ decision: string; count: number; total_orig: number; total_out: number }>;
}

/** 기간 값을 한국어 레이블로 변환 — 카드 제목에 선택된 기간 표시 */
const PERIOD_LABEL: Record<string, string> = {
  '1h': '1시간',
  '24h': '24시간',
  '7d': '7일',
  '30d': '30일',
};

interface Props {
  host: string;
  /** PeriodSelector 에서 전달받는 기간 값. 기본값 '30d'. */
  period?: string;
}

export function DomainTextCompressStats({ host, period = '30d' }: Props) {
  const { data, isLoading } = useQuery<StatsResponse>({
    // period를 queryKey에 포함시켜 기간 변경 시 자동 재조회
    queryKey: ['domain', host, 'text-compress-stats', period],
    queryFn: async () => {
      const res = await fetch(
        `/api/optimization/stats?type=text_compress&host=${encodeURIComponent(host)}&period=${encodeURIComponent(period)}`,
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
        <CardTitle className="text-base font-semibold">텍스트 압축 ({PERIOD_LABEL[period] ?? period} 누적)</CardTitle>
        <p className="text-sm text-muted-foreground">Phase 15 brotli/gzip 프리컴프레스 결과</p>
      </CardHeader>
      <CardContent>
        {/* mobile-first: 1열 → md 3열 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">처리 이벤트</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{(brCount + gzipCount).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">br {brCount} · gzip {gzipCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">원본 → 압축</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {formatBytes(totalOrig)} → {formatBytes(totalOut)}
              </p>
            </CardContent>
          </Card>
          <Card>
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
