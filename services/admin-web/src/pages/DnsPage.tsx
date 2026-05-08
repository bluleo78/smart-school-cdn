/** DNS 관리 페이지 — 디자인 시스템 일관성 리파인
 *  페이지 헤더 + 상태 스트립 + 3개 탭(레코드/통계/최근 쿼리).
 *  SystemPage / DashboardPage / DomainsPage 와 동일한 shadcn/ui · 시맨틱 토큰 패턴을 따른다. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, BarChart2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import {
  useDnsStatus,
  useDnsRecords,
  useDnsQueries,
  useDnsMetrics,
} from '../hooks/useDns';
import type { DnsQueryResultLabel, DnsMetricRange } from '../api/dns';
import { formatUptime, formatTime, formatNumber } from '../lib/format';

/** 결과 라벨 → Badge variant 매핑 */
const RESULT_VARIANT: Record<DnsQueryResultLabel, 'success' | 'outline' | 'destructive'> = {
  matched: 'success',
  forwarded: 'outline',
  nxdomain: 'destructive',
};

/** 결과 라벨 → 한국어 표시 텍스트 매핑 — 이슈 #25 (필터 버튼·Badge 한국어화) */
const RESULT_LABEL: Record<DnsQueryResultLabel, string> = {
  matched: '매칭',
  forwarded: '전달',
  nxdomain: 'NXDOMAIN',
};

/** 허용된 탭 값 목록 — 잘못된 파라미터가 들어올 경우 records로 폴백 (#114) */
const VALID_TABS = ['records', 'stats', 'queries'] as const;
type TabValue = (typeof VALID_TABS)[number];

/** URL searchParam ?tab= 값이 유효한지 검증하는 타입 가드 */
function isValidTab(value: string | null): value is TabValue {
  return VALID_TABS.includes(value as TabValue);
}

/** 통계 탭 range searchParam 화이트리스트 — 잘못된 값은 1h 기본값으로 폴백 (#228) */
const VALID_RANGES: readonly DnsMetricRange[] = ['1h', '24h'] as const;

/** URL searchParam ?range= 값이 유효한지 검증하는 타입 가드 */
function isValidRange(value: string | null): value is DnsMetricRange {
  return VALID_RANGES.includes(value as DnsMetricRange);
}

/** 최근 쿼리 탭 result 필터 화이트리스트 — 잘못된 값은 무시하고 전체 ON으로 폴백 (#292) */
const VALID_RESULTS: readonly DnsQueryResultLabel[] = ['matched', 'forwarded', 'nxdomain'] as const;

/** ?result=matched,forwarded 같은 콤마 구분 문자열을 Set으로 파싱 (#292).
 *  - null(파라미터 없음) → 기본 전체 ON Set
 *  - 빈 문자열(?result=) → 빈 Set (모두 OFF 상태도 명시적으로 표현 가능, #231 빈 상태 분기 보존)
 *  - 콤마 구분 값에서 유효한 라벨만 살리고 잘못된 값은 silent drop
 *  - 유효 값이 하나도 없는 가비지(`?result=invalid,unknown`) → 안전하게 전체 ON으로 폴백 */
function parseResultFilter(value: string | null): Set<DnsQueryResultLabel> {
  const all = new Set<DnsQueryResultLabel>(VALID_RESULTS);
  if (value === null) return all;
  if (value === '') return new Set<DnsQueryResultLabel>(); // 명시적 모두 OFF 상태
  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  const valid = parts.filter((s): s is DnsQueryResultLabel =>
    (VALID_RESULTS as readonly string[]).includes(s),
  );
  // 가비지만 들어온 경우(유효 값 0건) → 안전하게 default(전체 ON)로 폴백 — 사용자가 데이터를 잃지 않도록
  if (valid.length === 0) return all;
  return new Set(valid);
}

/** DNS 관리 페이지 루트 — 헤더 + 오프라인 배너 + 상태 스트립 + 3탭 */
export function DnsPage() {
  const { data: status, error: statusError } = useDnsStatus();
  // status 가 undefined(초기 로드 중)일 땐 배너 표시 금지 — 깜빡임 방지
  // /api/dns/status 자체가 실패(네트워크/5xx)한 경우도 offline 배너로 노출해
  // "상태 확인 불가" 사실을 사용자에게 알린다 (#173).
  const offline = status?.online === false || !!statusError;
  const statusUnavailable = !!statusError;

  // URL searchParam ?tab=... 으로 탭 상태를 영속화한다 (#114).
  // 뒤로가기·북마크·공유 링크로 특정 탭에 직접 접근할 수 있게 한다.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabValue = isValidTab(tabParam) ? tabParam : 'records';

  // 통계 탭의 range(1h/24h)도 URL searchParam ?range=... 으로 동기화한다 (#228).
  // 비활성 탭이 unmount되면서 StatsTab 내부 useState가 초기화되던 문제를 부모로 lifting.
  // DomainDetailTabs(#135)의 period 동기화 패턴을 동일하게 적용 — 새로고침/공유 시에도 유지.
  const rangeParam = searchParams.get('range');
  const statsRange: DnsMetricRange = isValidRange(rangeParam) ? rangeParam : '1h';

  // 레코드 탭 호스트 검색어 q와 최근 쿼리 탭 result 필터도 부모로 lifting + URL 동기화 (#292).
  // tab/range는 이미 동기화되는데 q/filter만 로컬 state로 남아 새로고침/공유 시 손실되던
  // 비일관 UX를 해결한다. DomainsPage(#68) 검색·필터 URL 동기화 패턴과 일관.
  const recordsQuery = searchParams.get('q') ?? '';
  const queriesFilter = useMemo(
    () => parseResultFilter(searchParams.get('result')),
    [searchParams],
  );

  /** 탭 전환 시 ?tab=<value> 를 URL에 반영한다.
   *  기존 ?range 파라미터는 보존해 통계 탭으로 돌아왔을 때도 동일 range 유지. */
  function handleTabChange(value: string) {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.set('tab', value);
        return next;
      },
      { replace: false },
    );
  }

  /** 통계 탭 range 토글 — ?range=<1h|24h>로 URL에 반영.
   *  같은 화면 내 필터 조정이므로 history 누적을 막기 위해 replace 사용 (DomainDetailTabs 패턴). */
  function handleRangeChange(value: DnsMetricRange) {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.set('range', value);
        return next;
      },
      { replace: true },
    );
  }

  /** 레코드 탭 검색어 q 변경 — ?q=<host>로 URL에 반영 (#292).
   *  - 빈 문자열일 때는 파라미터 제거 → URL을 깔끔하게 유지 (DomainsPage 패턴과 일관)
   *  - 검색어 변경은 history 누적 대상이 아니므로 replace 사용 (탭/range와 동일 정책) */
  const handleQueryChange = useCallback(
    (value: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (value) next.set('q', value);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** 최근 쿼리 탭 result 필터 변경 — ?result=matched,forwarded 형태로 URL에 반영 (#292).
   *  - 모두 ON(default 상태)이면 파라미터 제거 → URL 깔끔
   *  - 일부 OFF 상태만 콤마 구분 문자열로 직렬화. 입력 순서를 안정화하기 위해 VALID_RESULTS 순으로 정렬 */
  const handleResultFilterChange = useCallback(
    (next: Set<DnsQueryResultLabel>) => {
      setSearchParams(
        prev => {
          const params = new URLSearchParams(prev);
          if (next.size === VALID_RESULTS.length) {
            params.delete('result');
          } else {
            const ordered = VALID_RESULTS.filter(r => next.has(r));
            params.set('result', ordered.join(','));
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="space-y-6" data-testid="dns-page">
      {/* 페이지 헤더 — SystemPage / DomainsPage 패턴 */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">DNS</h2>
        <p className="text-sm text-muted-foreground mt-1">
          DNS 서비스 상태, 레코드, 쿼리 통계를 확인합니다.
        </p>
      </div>

      {/* 오프라인 배너 — SystemPage 의 destructive 배너와 동일 스타일.
       *  status 응답 실패(statusError) 시 "상태 확인 불가"로 메시지를 분기해
       *  서비스 오프라인(online=false)과 연결 실패(5xx/네트워크)를 구분 표기 (#173). */}
      {offline && (
        <div
          className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
          data-testid="dns-offline-banner"
        >
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              {statusUnavailable
                ? 'DNS 상태를 불러오지 못했습니다.'
                : 'DNS 서비스가 오프라인 상태입니다.'}
            </p>
            <p className="mt-1 text-sm">
              {statusUnavailable
                ? '관리자 서버 또는 dns-service 연결을 확인하세요.'
                : '서비스 상태를 확인하세요.'}
            </p>
          </div>
        </div>
      )}

      <StatusStrip />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="records" data-testid="tab-records">레코드</TabsTrigger>
          <TabsTrigger value="stats" data-testid="tab-stats">통계</TabsTrigger>
          <TabsTrigger value="queries" data-testid="tab-queries">최근 쿼리</TabsTrigger>
        </TabsList>
        <TabsContent value="records"><RecordsTab q={recordsQuery} onQueryChange={handleQueryChange} /></TabsContent>
        <TabsContent value="stats"><StatsTab range={statsRange} onRangeChange={handleRangeChange} /></TabsContent>
        <TabsContent value="queries"><QueriesTab filter={queriesFilter} onFilterChange={handleResultFilterChange} /></TabsContent>
      </Tabs>
    </div>
  );
}

/** 상단 상태 스트립 — 누적 Total 은 dns-service 기동 이후 기준, QPS 는 직전 1분 기준.
 *  3-state 처리: loading → Skeleton, error → ErrorCard, success → 칩 노출 (#173).
 *  error 분기가 누락되면 isLoading=false + status=undefined 상태에서 Skeleton 무한 노출. */
function StatusStrip() {
  const { data: status, isLoading, error } = useDnsStatus();
  const { data: metrics } = useDnsMetrics('1h');
  if (error) {
    return (
      <Card
        className="border-destructive/50 bg-destructive/5"
        data-testid="dns-status-error"
      >
        <CardContent className="py-4 text-sm text-destructive">
          DNS 상태를 불러오지 못했습니다: {String(error)}
        </CardContent>
      </Card>
    );
  }
  if (isLoading || !status) return <Skeleton className="h-16 w-full" />;

  // 직전 분 버킷의 total / 60 으로 QPS 근사 (현재 분은 누적 중이라 저평가되므로 제외)
  const prevMinuteBucket =
    metrics && metrics.length >= 2 ? metrics[metrics.length - 2] : undefined;
  const qpsRecent = prevMinuteBucket ? prevMinuteBucket.total / 60 : 0;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 py-4">
        {/* 상태 배지 */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${status.online ? 'bg-success' : 'bg-destructive'}`}
          />
          <Badge variant={status.online ? 'success' : 'destructive'} className="text-xs">
            {status.online ? '온라인' : '오프라인'}
          </Badge>
        </div>
        {/* 업타임 */}
        <StripStat label="가동 시간" value={formatUptime(status.uptime_secs)} />
        {/* 누적 쿼리 — status.total은 dns-service gRPC 라이브 카운터(서비스 부팅 후 누적).
         *  통계 탭 KPI '전체(1시간/24시간)'는 SQLite 시계열 합계로 데이터 소스/집계 범위가 다르므로
         *  같은 '전체' 라벨을 쓰면 사용자가 두 값(예: 0 vs 6,395)이 같은 의미라고 오해한다 (#240).
         *  라벨을 '라이브 누적'으로 구체화해 데이터 소스 의미를 분리한다. */}
        <StripStat label="라이브 누적" value={formatNumber(status.total)} />
        {/* QPS */}
        <StripStat label="QPS (직전 1분)" value={qpsRecent.toFixed(2)} />
      </CardContent>
    </Card>
  );
}

/** 상태 스트립 내부 칩 — 라벨 + 값 한 쌍 */
function StripStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** 레코드 탭 — 호스트 검색 필터 + A 레코드 테이블.
 *  q는 부모(DnsPage)에서 URL searchParam(?q)로 끌어올려 새로고침/공유 시 유지된다 (#292). */
function RecordsTab({ q, onQueryChange }: { q: string; onQueryChange: (value: string) => void }) {
  const { data: records, isLoading, error } = useDnsRecords();
  // localInput: IME 조합 중 input에 표시할 미완성 값(필터 트리거 X).
  // 조합 중에는 localInput만 갱신하고, compositionend에서 한 번에 q에 반영해 깜빡임을 막는다 (#209, #189 패턴).
  const [localInput, setLocalInput] = useState<string | null>(null);

  // IME 조합 중 여부를 동기적으로 추적 — onChange 시점의 e.nativeEvent.isComposing이
  // compositionend 직후 false로 보일 수 있는 React 합성 이벤트 처리 순서 문제를 우회한다 (DomainToolbar 동일).
  const composingRef = useRef(false);

  // 표시값: 조합 중이면 localInput, 그 외엔 q.
  const searchValue = localInput ?? q;

  // 미완성 자모(예: `ㅎ`, `갂`)가 클라이언트 필터에 즉시 반영되는 것을 막는다.
  // 조합 중에는 표시값만 갱신하고 q(=필터 트리거)는 보류한다 (#209).
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalInput(value);
      // 표준 가드: ref(가장 신뢰) || isComposing(모던) || keyCode 229(레거시).
      const ne = e.nativeEvent as InputEvent & { keyCode?: number };
      if (composingRef.current || ne.isComposing || ne.keyCode === 229) {
        return; // 조합 중 — 필터 보류
      }
      onQueryChange(value);
      setLocalInput(null);
    },
    [onQueryChange],
  );

  // IME 조합 시작 — 진행 중 input 이벤트는 필터 트리거 안 함
  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  // IME 조합 종료 — 최종 값을 한 번만 q에 반영해 정확히 1회 필터링
  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      const value = e.currentTarget.value;
      onQueryChange(value);
      setLocalInput(null);
    },
    [onQueryChange],
  );

  // 검색어 정규화 — 복사·붙여넣기로 따라오는 앞뒤 공백 때문에 정상 호스트가 0건으로
  // 떨어지는 문제를 방지 (#241). 표시용 input value(searchValue)는 그대로 두고 필터
  // 트리거에만 trim된 값을 사용한다. DomainsPage의 host.trim().toLowerCase() 패턴과 일관.
  const trimmedQ = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (records ?? []).filter(r => r.host.toLowerCase().includes(trimmedQ)),
    [records, trimmedQ],
  );

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <ErrorCard message={String(error)} />;

  return (
    <Card>
      {/* 모바일(<sm) 좁은 뷰포트에서 헤더가 단어 중간 줄바꿈되는 것을 방지하기 위해
       *  flex-col로 stack 처리하고 sm 이상에서 좌우 배치 (#177) */}
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* whitespace-nowrap — "DNS 레코 / 드 (7)" 단어 중간 줄바꿈 차단 (#177) */}
        <CardTitle className="whitespace-nowrap">DNS 레코드 ({filtered.length})</CardTitle>
        <Input
          placeholder="호스트 검색…"
          value={searchValue}
          onChange={handleSearchChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="max-w-xs"
          data-testid="records-filter"
        />
      </CardHeader>
      <CardContent>
        {/* 검색어 유무에 따라 빈 상태 메시지 분기 — 검색 결과 없음과 데이터 없음을 구분 */}
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {trimmedQ ? `"${trimmedQ}"에 일치하는 레코드가 없습니다.` : '등록된 레코드가 없습니다.'}
          </p>
        ) : (
          // overflow-x-auto 래퍼 — 좁은 뷰포트에서 페이지 전체 가로 스크롤 대신 테이블만 스크롤 (#177)
          <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {/* 한국어 UI 통일 — 이슈 #19. whitespace-nowrap — "유 / 형" 글자 단위 분할 차단 (#177) */}
                <TableHead className="whitespace-nowrap">호스트</TableHead>
                <TableHead className="whitespace-nowrap">대상 IP</TableHead>
                <TableHead className="whitespace-nowrap">유형</TableHead>
                <TableHead className="whitespace-nowrap">출처</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.host} className="hover:bg-muted/50">
                  <TableCell className="font-mono whitespace-nowrap">{r.host}</TableCell>
                  <TableCell className="font-mono text-muted-foreground whitespace-nowrap">{r.target}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.rtype}</TableCell>
                  <TableCell className="whitespace-nowrap"><Badge variant="outline">{r.source}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 통계 탭 — 카드 4종 + 범위 토글 + 시계열 차트 + Top 10.
 *  range는 부모(DnsPage)에서 URL searchParam(?range)로 끌어올려 탭 전환·새로고침에도 유지된다 (#228). */
function StatsTab({ range, onRangeChange }: { range: DnsMetricRange; onRangeChange: (r: DnsMetricRange) => void }) {
  // status 에러 신호는 Top 10 카드에서 분리 노출해야 함 — !status 만 검사하면 5xx 시 "쿼리가 없습니다" 오표시 (#174)
  const { data: status, isLoading: statusLoading, error: statusError } = useDnsStatus();
  const { data: metrics, isLoading, error } = useDnsMetrics(range);

  const totals = useMemo(() => {
    const base = { total: 0, matched: 0, nxdomain: 0, forwarded: 0 };
    return (metrics ?? []).reduce(
      (acc, b) => ({
        total: acc.total + b.total,
        matched: acc.matched + b.matched,
        nxdomain: acc.nxdomain + b.nxdomain,
        forwarded: acc.forwarded + b.forwarded,
      }),
      base,
    );
  }, [metrics]);

  if (error) return <ErrorCard message={String(error)} />;

  return (
    <div className="space-y-6">
      {/* KPI 카드 4장 — DomainSummaryCards 의 text-3xl font-bold 패턴.
       *  '전체' 라벨에 현재 range(1시간/24시간)를 명시 — 상단 strip의 '라이브 누적'(status.total)과
       *  데이터 소스/집계 범위가 다른데 같은 라벨을 쓰면 사용자가 어느 값이 정답인지 판단 불가 (#240). */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {/* 한국어 UI 통일 — 이슈 #19 */}
        <StatCard label={range === '1h' ? '전체 (1시간)' : '전체 (24시간)'} value={totals.total} />
        <StatCard label="매칭" value={totals.matched} accent="text-success" />
        <StatCard label="전달" value={totals.forwarded} accent="text-muted-foreground" />
        {/* NXDOMAIN > 0일 때만 destructive 색상 적용 — 0이면 정상 상태이므로 기본 색 사용 */}
        {/* 기술 용어 NXDOMAIN은 영문 유지하되 한국어 부연을 병기 — 이슈 #25 */}
        <StatCard label="없음(NXDOMAIN)" value={totals.nxdomain} accent={totals.nxdomain > 0 ? 'text-destructive' : undefined} testid="statcard-label-NXDOMAIN" />
      </div>

      {/* 시계열 차트 — CacheHitRateChart 패턴(CSS 변수 stroke) */}
      <Card>
        {/* 모바일 stack 처리 — 좁은 뷰포트에서 헤더와 토글 버튼이 가로 오버플로 발생하지 않도록 (#177) */}
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="whitespace-nowrap">쿼리 추이</CardTitle>
          <div className="flex gap-2">
            {/* aria-pressed: 스크린 리더가 현재 선택된 기간을 인식할 수 있도록 토글 상태 노출 */}
            <Button
              variant={range === '1h' ? 'default' : 'outline'}
              aria-pressed={range === '1h'}
              onClick={() => onRangeChange('1h')}
              size="xs"
            >
              1시간
            </Button>
            <Button
              variant={range === '24h' ? 'default' : 'outline'}
              aria-pressed={range === '24h'}
              onClick={() => onRangeChange('24h')}
              size="xs"
            >
              24시간
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-72">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : !metrics || metrics.length === 0 ? (
            /* 데이터 없음 — 빈 캔버스 대신 안내 메시지로 대체 (CacheHitRateChart 패턴 준용) */
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <BarChart2 size={32} className="opacity-30" />
              <p className="text-sm">아직 데이터가 없습니다</p>
              <p className="text-xs">DNS 쿼리가 들어오면 자동으로 표시됩니다</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={(metrics ?? []).map(b => ({
                  ...b,
                  /* x축 라벨 — 24시간 범위에서는 같은 시각이 어제/오늘 두 번 등장 가능하므로
                   * 'MM/DD HH:mm'으로 날짜를 함께 표시해 디스앰비귀에이션 (#198).
                   * 1시간 범위는 5분 버킷이라 'HH:mm'만으로 충분.
                   * toLocaleString의 ko-KR 포맷('05. 07. 09:00')은 구분자 일관성 부족 → 직접 포맷. */
                  t: (() => {
                    const d = new Date(b.ts);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    return range === '24h'
                      ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hhmm}`
                      : hhmm;
                  })(),
                }))}
                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                {/* 툴팁 헤더는 항상 전체 날짜·시각 노출 — 어떤 범위에서든 정확한 시점 식별 가능 (#198).
                 * payload[0].payload.ts(epoch ms)로부터 'YYYY-MM-DD HH:mm' 포맷팅. */}
                <ChartTooltip
                  labelFormatter={(_label, payload) => {
                    const ts = (payload?.[0]?.payload as { ts?: number } | undefined)?.ts;
                    if (typeof ts !== 'number') return _label as string;
                    const d = new Date(ts);
                    const pad = (n: number) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                  }}
                  /* 값은 천단위 콤마로 가독성 확보 — KPI 카드 toLocaleString 표기와 일관 (#222) */
                  formatter={(value: number | string) =>
                    typeof value === 'number' ? formatNumber(value) : value
                  }
                />
                {/* Legend — KPI 카드(전체/매칭/전달/없음)와 라인 색상 매핑을 식별 가능하게 노출 (#222).
                 * Line의 name 속성으로 한국어 라벨을 부여하면 Tooltip 항목명 / Legend 둘 다 동일하게 적용됨. */}
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {/* 토큰 기반 stroke — 다크모드에서도 자동 대응 */}
                <Line
                  type="monotone"
                  dataKey="total"
                  name="전체"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="matched"
                  name="매칭"
                  stroke="var(--color-success)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="forwarded"
                  name="전달"
                  stroke="var(--color-muted-foreground)"
                  strokeWidth={2}
                  dot={false}
                />
                {/* nxdomain 시리즈 — KPI에는 표시되지만 차트에 누락되어 데이터 정합성이 어긋났던 결함 수정 (#222).
                 * KPI \"없음(NXDOMAIN)\"이 nxdomain>0일 때 destructive 색상이므로 라인도 동일 토큰 사용. */}
                <Line
                  type="monotone"
                  dataKey="nxdomain"
                  name="없음"
                  stroke="var(--color-destructive)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Top 10 — 랭크 컬럼은 monospace + muted */}
      <Card>
        <CardHeader>
          {/* break-keep — 한국어 단어 단위 줄바꿈 (글자 단위 분할 차단) (#177) */}
          <CardTitle className="break-keep">Top 10 쿼리 도메인 (최근 쿼리 스냅샷)</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 3-state 분기 (#174): error → ErrorCard, loading → Skeleton, empty → 안내, data → Table.
              !status 만 검사하면 useDnsStatus 5xx 시 빈 상태 메시지로 오표시되어 사용자가
              데이터 없음과 장애를 구분할 수 없음. */}
          {statusError ? (
            <div data-testid="dns-top10-error">
              <ErrorCard message={`Top 10을 불러오지 못했습니다: ${String(statusError)}`} />
            </div>
          ) : statusLoading || !status ? (
            <Skeleton className="h-40 w-full" />
          ) : status.top_domains.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">쿼리가 없습니다.</p>
          ) : (
            // overflow-x-auto 래퍼 — 좁은 뷰포트에서 페이지 전체 가로 스크롤 차단 (#177)
            <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* 한국어 UI 통일 — 이슈 #19 */}
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="whitespace-nowrap">도메인</TableHead>
                  <TableHead className="text-right whitespace-nowrap">횟수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.top_domains.map((d, i) => (
                  <TableRow key={d.qname} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-mono whitespace-nowrap">{d.qname}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatNumber(d.count)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 최근 쿼리 탭 — 결과별 필터 토글 + 최대 100행 테이블.
 *  filter는 부모(DnsPage)에서 URL searchParam(?result)로 끌어올려 새로고침/공유 시 유지된다 (#292). */
function QueriesTab({
  filter,
  onFilterChange,
}: {
  filter: Set<DnsQueryResultLabel>;
  onFilterChange: (next: Set<DnsQueryResultLabel>) => void;
}) {
  const { data: queries, isLoading, error } = useDnsQueries(100);
  const visible = useMemo(
    () => (queries ?? []).filter(e => filter.has(e.result)),
    [queries, filter],
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <ErrorCard message={String(error)} />;

  function toggle(r: DnsQueryResultLabel) {
    const next = new Set(filter);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    onFilterChange(next);
  }

  // 빈 상태 분기용 — 결과 필터 일부라도 해제되어 있는지 판정
  // 진짜 쿼리 0건과 "필터로 0건 매칭" 두 상황을 메시지·CTA로 구분한다 (#231, #227 패턴)
  const allResults: DnsQueryResultLabel[] = ['matched', 'forwarded', 'nxdomain'];
  const hasActiveFilter = filter.size < allResults.length;
  const totalCount = queries?.length ?? 0;

  /** 결과 필터 일괄 초기화 — 빈 상태 안내 패널의 CTA에서 사용 */
  function handleResetFilters() {
    onFilterChange(new Set<DnsQueryResultLabel>(allResults));
  }

  return (
    <Card>
      {/* 모바일 stack — 헤더+필터 버튼이 좁은 뷰포트에서 가로 오버플로 발생 차단 (#177) */}
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="whitespace-nowrap">최근 쿼리 ({visible.length} / {queries?.length ?? 0})</CardTitle>
        <div className="flex gap-2">
          {(['matched', 'forwarded', 'nxdomain'] as DnsQueryResultLabel[]).map(r => (
            // aria-pressed: 스크린 리더가 필터 활성 상태를 인식할 수 있도록 ARIA 상태 추가
            <Button
              key={r}
              variant={filter.has(r) ? 'default' : 'outline'}
              aria-pressed={filter.has(r)}
              onClick={() => toggle(r)}
              size="xs"
              data-testid={`filter-${r}`}
            >
              {/* 이슈 #25: 영문 값 대신 한국어 레이블 표시 */}
              {RESULT_LABEL[r]}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          // 빈 상태 분기 (#231) — 필터 활성/비활성에 따라 안내 메시지 + CTA를 다르게 노출한다
          // (a) 필터 비활성(전부 켜짐) 또는 데이터 자체 0건 → "표시할 쿼리가 없습니다."
          // (b) 필터로 인해 0건 매칭 → 활성 필터 정보가 포함된 안내 + 초기화 버튼
          hasActiveFilter && totalCount > 0 ? (
            <div
              className="flex flex-col items-center gap-2 py-8 text-muted-foreground"
              data-testid="queries-empty-filter"
            >
              <p className="text-sm font-medium text-foreground">
                선택한 결과 필터에 일치하는 쿼리가 없습니다.
              </p>
              <p className="text-xs">필터 조건을 변경하거나 초기화해 보세요.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                data-testid="queries-reset-filters-btn"
              >
                필터 초기화
              </Button>
            </div>
          ) : (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              data-testid="queries-empty"
            >
              표시할 쿼리가 없습니다.
            </p>
          )
        ) : (
          // overflow-x-auto 래퍼 — 좁은 뷰포트에서 페이지 가로 스크롤 차단 (#177)
          <div className="w-full overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {/* 한국어 UI 통일 — 이슈 #19. whitespace-nowrap — 컬럼 헤더 글자 단위 분할 차단 (#177) */}
                <TableHead className="whitespace-nowrap">시각</TableHead>
                <TableHead className="whitespace-nowrap">클라이언트</TableHead>
                <TableHead className="whitespace-nowrap">도메인</TableHead>
                <TableHead className="whitespace-nowrap">유형</TableHead>
                <TableHead className="whitespace-nowrap">결과</TableHead>
                <TableHead className="text-right whitespace-nowrap">지연</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((e, i) => (
                <TableRow key={`${e.ts_unix_ms}-${i}`} className="hover:bg-muted/50">
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {/* #223: 인자 없는 toLocaleTimeString()은 12시간제(오전/오후)로 폴백 — 앱 전체 24시간 정책 통일 */}
                    {formatTime(e.ts_unix_ms)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.client_ip}</TableCell>
                  <TableCell className="font-mono truncate max-w-[280px]">{e.qname}</TableCell>
                  <TableCell className="text-muted-foreground">{e.qtype}</TableCell>
                  {/* 이슈 #25: 결과 값 영문 → 한국어 레이블로 표시 */}
                  <TableCell><Badge variant={RESULT_VARIANT[e.result]}>{RESULT_LABEL[e.result]}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(e.latency_us / 1000).toFixed(2)} ms
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** KPI 카드 — 라벨 + 큰 숫자 (DomainSummaryCards 패턴 ·text-3xl font-bold) */
function StatCard({
  label,
  value,
  accent,
  testid,
}: {
  label: string;
  value: number;
  accent?: string;
  /** E2E 테스트용 안정적 testid — label과 독립적으로 유지 */
  testid?: string;
}) {
  return (
    <Card>
      <CardContent className="py-5">
        {/* data-testid로 E2E에서 라벨 색상 검증 가능하게 노출 */}
        <p data-testid={testid ?? `statcard-label-${label}`} className={`text-xs font-medium ${accent ?? 'text-muted-foreground'}`}>{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{formatNumber(value)}</p>
      </CardContent>
    </Card>
  );
}

/** 에러 발생 시 표시할 공통 카드 */
function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardContent className="py-4 text-sm text-destructive">
        데이터 로드 실패: {message}
      </CardContent>
    </Card>
  );
}
