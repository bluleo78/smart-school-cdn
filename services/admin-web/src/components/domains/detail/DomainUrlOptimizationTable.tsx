/// Phase 16-3: URL별 최적화 내역 표.
/// 검색(URL 부분일치) + decision 필터 + 정렬(savings/orig_size/events) + 페이지네이션.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Skeleton } from '../../ui/skeleton';
import { formatBytes } from '../../../lib/format';
import { useDomainUrlOptimization } from '../../../hooks/useDomainUrlOptimization';

type Sort = 'savings' | 'orig_size' | 'events';
type Period = '1h' | '24h' | '7d' | '30d';
// decision 값은 proxy/optimizer-service가 DB에 저장하는 실제 문자열과 일치해야 한다
// (optimizer-service OptimizeDecision::as_str, proxy text_compress decision 분기 참조).
// PascalCase를 보내면 WHERE 절이 일치하지 않아 필터가 전부 빈 결과를 반환한다.
type Decision =
  | 'all'
  | 'optimized'
  | 'passthrough_larger'
  | 'passthrough_error'
  | 'passthrough_unsupported'
  | 'compressed_br'
  | 'compressed_gzip'
  | 'skipped_small'
  | 'skipped_type';

const PAGE = 50;

export function DomainUrlOptimizationTable({ host, period = '24h' }: { host: string; period?: Period }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('savings');
  const [decision, setDecision] = useState<Decision>('all');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useDomainUrlOptimization({
    host,
    period,
    sort,
    decision: decision === 'all' ? undefined : decision,
    q: q.trim() || undefined,
    limit: PAGE,
    offset,
  });

  return (
    <Card data-testid="url-optimization-table">
      <CardHeader>
        <CardTitle className="text-base font-semibold">URL별 최적화 내역</CardTitle>
        <p className="text-sm text-muted-foreground">선택 기간 내 optimization_events 기반 집계</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="URL 검색"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            className="flex-1 min-w-40"
            data-testid="url-opt-search"
          />
          <select
            value={decision}
            onChange={(e) => {
              setDecision(e.target.value as Decision);
              setOffset(0);
            }}
            className="bg-background border border-border rounded px-2 py-1 text-sm"
            data-testid="url-opt-decision"
          >
            <option value="all">decision: 전체</option>
            <option value="optimized">이미지 · 최적화됨</option>
            <option value="passthrough_larger">이미지 · 원본 유지(커짐)</option>
            <option value="passthrough_error">이미지 · 원본 유지(에러)</option>
            <option value="passthrough_unsupported">이미지 · 지원 안 함</option>
            <option value="compressed_br">텍스트 · br</option>
            <option value="compressed_gzip">텍스트 · gzip</option>
            <option value="skipped_small">스킵 · 너무 작음</option>
            <option value="skipped_type">스킵 · 타입/헤더 불가</option>
          </select>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setOffset(0);
            }}
            className="bg-background border border-border rounded px-2 py-1 text-sm"
            data-testid="url-opt-sort"
          >
            <option value="savings">절감률 ↓</option>
            <option value="orig_size">원본 크기 ↓</option>
            <option value="events">이벤트 수 ↓</option>
          </select>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : data && data.items.length > 0 ? (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground uppercase tracking-wide text-left">
                  <th className="py-2 pr-3">URL</th>
                  <th className="py-2 pr-3">이벤트</th>
                  <th className="py-2 pr-3">원본</th>
                  <th className="py-2 pr-3">최적화 후</th>
                  <th className="py-2 pr-3">절감</th>
                  <th className="py-2">decision</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.url} className="border-t border-border/40">
                    <td className="py-2 pr-3 truncate max-w-xs" title={it.url}>
                      {it.url}
                    </td>
                    <td className="py-2 pr-3">{it.events}</td>
                    <td className="py-2 pr-3">{formatBytes(it.total_orig)}</td>
                    <td className="py-2 pr-3">{formatBytes(it.total_out)}</td>
                    <td
                      className={`py-2 pr-3 ${
                        it.savings_ratio > 0 ? 'text-success font-semibold' : 'text-muted-foreground'
                      }`}
                    >
                      {(it.savings_ratio * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{it.decisions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>총 {data.total.toLocaleString()} URL</span>
              <div className="flex gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(o - PAGE, 0))}
                  className="px-2 py-1 rounded border border-border disabled:opacity-40"
                >
                  이전
                </button>
                <button
                  disabled={offset + PAGE >= data.total}
                  onClick={() => setOffset((o) => o + PAGE)}
                  className="px-2 py-1 rounded border border-border disabled:opacity-40"
                >
                  다음
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">집계된 이벤트 없음</p>
        )}
      </CardContent>
    </Card>
  );
}
