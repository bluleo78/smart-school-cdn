/// Phase 16-3: URL별 최적화 내역 표.
/// 검색(URL 부분일치) + decision 필터 + 정렬(savings/orig_size/events) + 페이지네이션.
/// (수정 #54) raw <select>/<table>/<button> → shadcn Select/Table/Button 컴포넌트로 교체.
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../ui/table';
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
          {/* decision 필터 — shadcn Select 컴포넌트 사용 */}
          <Select
            value={decision}
            onValueChange={(v) => {
              setDecision(v as Decision);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-48 text-sm" data-testid="url-opt-decision">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">결과: 전체</SelectItem>
              <SelectItem value="optimized">이미지 · 최적화됨</SelectItem>
              <SelectItem value="passthrough_larger">이미지 · 원본 유지(커짐)</SelectItem>
              <SelectItem value="passthrough_error">이미지 · 원본 유지(에러)</SelectItem>
              <SelectItem value="passthrough_unsupported">이미지 · 지원 안 함</SelectItem>
              <SelectItem value="compressed_br">텍스트 · br</SelectItem>
              <SelectItem value="compressed_gzip">텍스트 · gzip</SelectItem>
              <SelectItem value="skipped_small">스킵 · 너무 작음</SelectItem>
              <SelectItem value="skipped_type">스킵 · 타입/헤더 불가</SelectItem>
            </SelectContent>
          </Select>
          {/* 정렬 기준 — shadcn Select 컴포넌트 사용 */}
          <Select
            value={sort}
            onValueChange={(v) => {
              setSort(v as Sort);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-32 text-sm" data-testid="url-opt-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="savings">절감률 ↓</SelectItem>
              <SelectItem value="orig_size">원본 크기 ↓</SelectItem>
              <SelectItem value="events">이벤트 수 ↓</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : data && data.items.length > 0 ? (
          <>
            {/* URL별 최적화 내역 테이블 — shadcn Table 컴포넌트 사용 */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="py-2 pr-3">URL</TableHead>
                  <TableHead className="py-2 pr-3">이벤트</TableHead>
                  <TableHead className="py-2 pr-3">원본</TableHead>
                  <TableHead className="py-2 pr-3">최적화 후</TableHead>
                  <TableHead className="py-2 pr-3">절감</TableHead>
                  <TableHead className="py-2">최적화 결정</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((it) => (
                  <TableRow key={it.url}>
                    <TableCell className="py-2 pr-3 truncate max-w-xs" title={it.url}>
                      {it.url}
                    </TableCell>
                    <TableCell className="py-2 pr-3">{it.events}</TableCell>
                    <TableCell className="py-2 pr-3">{formatBytes(it.total_orig)}</TableCell>
                    <TableCell className="py-2 pr-3">{formatBytes(it.total_out)}</TableCell>
                    <TableCell
                      className={`py-2 pr-3 ${
                        it.savings_ratio > 0 ? 'text-success font-semibold' : 'text-muted-foreground'
                      }`}
                    >
                      {(it.savings_ratio * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{it.decisions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* 페이지네이션 — shadcn Button 컴포넌트 사용 */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>총 {data.total.toLocaleString()} URL</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(o - PAGE, 0))}
                  data-testid="url-opt-prev"
                >
                  이전
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={offset + PAGE >= data.total}
                  onClick={() => setOffset((o) => o + PAGE)}
                  data-testid="url-opt-next"
                >
                  다음
                </Button>
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
