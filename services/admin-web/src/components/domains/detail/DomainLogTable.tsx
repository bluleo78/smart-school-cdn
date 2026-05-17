/// 도메인 요청 로그 테이블 — 검색/에러 필터, 자동 갱신 + 기간 필터 지원
import { useState } from 'react';
import { useDomainLogs } from '../../../hooks/useDomainLogs';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
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

  // period 또는 errorsOnly 변경 시 limit을 초기값(50)으로 리셋한다.
  // DomainUrlOptimizationTable의 prev-prop 비교 패턴 적용 — 회귀 방지 #158
  const [prevPeriod, setPrevPeriod] = useState(period);
  const [prevErrorsOnly, setPrevErrorsOnly] = useState(errorsOnly);
  if (period !== prevPeriod || errorsOnly !== prevErrorsOnly) {
    setPrevPeriod(period);
    setPrevErrorsOnly(errorsOnly);
    setLimit(50);
  }

  // 검색어 debounce — keystroke 마다 /logs API 가 발사되는 fan-in 부하 차단 (#374).
  // 클라이언트 측 filter 는 즉시값(search)으로 유지해 사용자 체감 반응은 동일하게 두고,
  // 서버 호출(queryKey 의 q 파라미터)만 250ms 안정화한다. 같은 패턴: DomainDiagnoseTab (#402).
  const debouncedSearch = useDebouncedValue(search, 250);

  const { data, isLoading, error } = useDomainLogs(
    host,
    {
      limit,
      offset: 0,
      q: debouncedSearch || undefined,
      // 'error' 필터: 4xx + 5xx 모두 포함 — '5xx'만 전송 시 4xx 에러가 누락되는 버그 수정 (#46)
      status: errorsOnly ? 'error' : undefined,
      period,
      from: range?.from,
      to: range?.to,
    },
    refetchIntervalMs,
  );

  const logs = data ?? [];

  /** 필터 적용: 검색어만 — errorsOnly는 API 파라미터(status:'error')로 위임하므로 클라이언트 중복 필터 제거 (#134) */
  const filtered = logs.filter((log) => {
    if (search && !log.path.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // 빈 상태 분기용 — 검색어/에러필터 활성 여부
  // 진짜 로그 0건과 "필터로 0건 매칭" 두 상황을 메시지·CTA로 구분한다 (#227)
  const hasActiveFilter = search.length > 0 || errorsOnly;

  /** 검색어/필터 일괄 초기화 — 빈 상태 안내 패널의 CTA에서 사용 */
  function handleClearFilters() {
    setSearch('');
    setErrorsOnly(false);
  }

  return (
    // 형제 카드(요청 추이/Top URL)와 컨테이너 위계 일관성을 위해 Card 래퍼로 감싼다 (#260)
    <Card data-testid="domain-log-table-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold">요청 로그</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 필터 바 */}
        <div className="flex gap-2 items-center">
          <Input
            placeholder="경로 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-8 text-xs"
            data-testid="domain-logs-search-input"
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

        {/* 로딩/에러 상태도 카드 컨테이너 내부에서 표현해 위계 유지 */}
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">로그 로드 실패</p>
        ) : filtered.length === 0 ? (
          // 빈 상태 분기 — 필터 활성/비활성에 따라 안내 메시지 + CTA를 다르게 노출한다 (#227)
          // (a) 필터 비활성 → "로그가 없습니다" (실제 데이터 0건)
          // (b) 필터 활성 → 검색어/에러필터 정보가 포함된 안내 + 초기화 버튼
          hasActiveFilter ? (
            <div
              className="flex flex-col items-center gap-2 py-6 text-muted-foreground"
              data-testid="domain-logs-empty-filter"
            >
              <p className="text-sm font-medium text-foreground">
                {search.length > 0 && errorsOnly ? (
                  <>
                    검색어 <strong>&ldquo;{search}&rdquo;</strong> + &lsquo;에러만&rsquo; 조건에 맞는 로그가 없습니다.
                  </>
                ) : search.length > 0 ? (
                  <>
                    검색어 <strong>&ldquo;{search}&rdquo;</strong>에 일치하는 로그가 없습니다.
                  </>
                ) : (
                  <>&lsquo;에러만&rsquo; 필터에 맞는 로그가 없습니다.</>
                )}
              </p>
              <p className="text-xs">조건을 변경하거나 초기화해 보세요.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                data-testid="domain-logs-clear-filters-btn"
              >
                검색·필터 초기화
              </Button>
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground py-4 text-center"
              data-testid="domain-logs-empty"
            >
              로그가 없습니다
            </p>
          )
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
      </CardContent>
    </Card>
  );
}
