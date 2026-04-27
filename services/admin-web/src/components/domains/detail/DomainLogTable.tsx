/// 도메인 요청 로그 테이블 — 검색/에러 필터, 자동 갱신 + 기간 필터 지원
import { useState } from 'react';
import { useDomainLogs } from '../../../hooks/useDomainLogs';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import type { StatsPeriod } from '../../../api/domains';

interface Props {
  host: string;
  /** 조회 기간 — 미지정 시 서버 기본값 사용 */
  period?: StatsPeriod;
  /** custom 기간일 때 epoch 범위 */
  range?: { from: number; to: number };
  /** 자동 갱신 주기(ms). false 또는 0이면 비활성 */
  refetchIntervalMs?: number | false;
}

/** HTTP 상태 코드별 색상 클래스 반환 */
function statusColor(code: number): string {
  if (code >= 500) return 'text-destructive';
  if (code >= 400) return 'text-warning';
  return 'text-success';
}

/** 캐시 상태별 색상 클래스 반환 */
function cacheColor(status: 'HIT' | 'MISS'): string {
  return status === 'HIT' ? 'text-success' : 'text-destructive';
}

export function DomainLogTable({ host, period, range, refetchIntervalMs = false }: Props) {
  /** 검색어 필터 state */
  const [search, setSearch] = useState('');
  /** 에러만 표시 토글 state */
  const [errorsOnly, setErrorsOnly] = useState(false);
  /** 로그 표시 건수 — 기본 50, "더 보기"로 50씩 증가 */
  const [limit, setLimit] = useState(50);

  const { data, isLoading, error } = useDomainLogs(
    host,
    {
      limit,
      offset: 0,
      q: search || undefined,
      // 'error' 필터: 4xx + 5xx 모두 포함 — '5xx'만 전송 시 4xx 에러가 누락되는 버그 수정 (#46)
      status: errorsOnly ? 'error' : undefined,
      period,
      from: range?.from,
      to: range?.to,
    },
    refetchIntervalMs,
  );

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (error) {
    return <p className="text-sm text-destructive">로그 로드 실패</p>;
  }

  const logs = data ?? [];

  /** 필터 적용: 검색어 + 에러만 */
  const filtered = logs.filter((log) => {
    if (errorsOnly && log.status_code < 400) return false;
    if (search && !log.path.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="경로 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-xs"
        />
        <Button
          variant={errorsOnly ? 'default' : 'outline'}
          onClick={() => setErrorsOnly((v) => !v)}
          aria-pressed={errorsOnly}
          size="sm"
        >
          에러만
        </Button>
      </div>

      {/* 로그 테이블 */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">로그가 없습니다</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/40">
          {/* shadcn Table 컴포넌트 사용 — 앱 전체 디자인 시스템 일관성 유지 (#116) */}
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="py-2">시간</TableHead>
                <TableHead className="py-2">경로</TableHead>
                <TableHead className="py-2">상태</TableHead>
                <TableHead className="py-2 text-right">크기</TableHead>
                <TableHead className="py-2">캐시</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log, i) => (
                <TableRow key={i}>
                  {/* 타임스탬프(초) → 날짜+시간 — 날짜 없이 시간만 표시하면 다날에 걸친 로그 판독 불가 (#94) */}
                  <TableCell className="py-1.5 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(log.timestamp * 1000)}
                  </TableCell>
                  <TableCell className="py-1.5 text-foreground max-w-[320px] truncate">
                    {log.path}
                  </TableCell>
                  <TableCell className={`py-1.5 font-medium ${statusColor(log.status_code)}`}>
                    {log.status_code}
                  </TableCell>
                  <TableCell className="py-1.5 text-right text-muted-foreground">
                    {formatBytes(log.size)}
                  </TableCell>
                  <TableCell className={`py-1.5 font-medium ${cacheColor(log.cache_status)}`}>
                    {log.cache_status}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 더 보기 버튼 — 로그가 limit 이상이면 추가 로드 가능 */}
      {data && data.length >= limit && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={() => setLimit(prev => prev + 50)}>
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}
