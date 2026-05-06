/** DNS 관리 페이지 — 디자인 시스템 일관성 리파인
 *  페이지 헤더 + 상태 스트립 + 3개 탭(레코드/통계/최근 쿼리).
 *  SystemPage / DashboardPage / DomainsPage 와 동일한 shadcn/ui · 시맨틱 토큰 패턴을 따른다. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, BarChart2 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
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
import { formatUptime } from '../lib/format';

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

  /** 탭 전환 시 ?tab=<value> 를 URL에 반영한다 */
  function handleTabChange(value: string) {
    setSearchParams({ tab: value }, { replace: false });
  }

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
        <TabsContent value="records"><RecordsTab /></TabsContent>
        <TabsContent value="stats"><StatsTab /></TabsContent>
        <TabsContent value="queries"><QueriesTab /></TabsContent>
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
        {/* 누적 쿼리 */}
        <StripStat label="전체" value={status.total.toLocaleString()} />
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

/** 레코드 탭 — 호스트 검색 필터 + A 레코드 테이블 */
function RecordsTab() {
  const { data: records, isLoading, error } = useDnsRecords();
  const [q, setQ] = useState('');

  const filtered = useMemo(
    () => (records ?? []).filter(r => r.host.toLowerCase().includes(q.toLowerCase())),
    [records, q],
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
          value={q}
          onChange={e => setQ(e.target.value)}
          className="max-w-xs"
          data-testid="records-filter"
        />
      </CardHeader>
      <CardContent>
        {/* 검색어 유무에 따라 빈 상태 메시지 분기 — 검색 결과 없음과 데이터 없음을 구분 */}
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {q ? `"${q}"에 일치하는 레코드가 없습니다.` : '등록된 레코드가 없습니다.'}
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

/** 통계 탭 — 카드 4종 + 범위 토글 + 시계열 차트 + Top 10 */
function StatsTab() {
  const [range, setRange] = useState<DnsMetricRange>('1h');
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
      {/* KPI 카드 4장 — DomainSummaryCards 의 text-3xl font-bold 패턴 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {/* 한국어 UI 통일 — 이슈 #19 */}
        <StatCard label="전체" value={totals.total} />
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
              onClick={() => setRange('1h')}
              size="xs"
            >
              1시간
            </Button>
            <Button
              variant={range === '24h' ? 'default' : 'outline'}
              aria-pressed={range === '24h'}
              onClick={() => setRange('24h')}
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
                  t: new Date(b.ts).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  }),
                }))}
                margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <ChartTooltip />
                {/* 토큰 기반 stroke — 다크모드에서도 자동 대응 */}
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="matched"
                  stroke="var(--color-success)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="forwarded"
                  stroke="var(--color-muted-foreground)"
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
                      {d.count.toLocaleString()}
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

/** 최근 쿼리 탭 — 결과별 필터 토글 + 최대 100행 테이블 */
function QueriesTab() {
  const { data: queries, isLoading, error } = useDnsQueries(100);
  const [filter, setFilter] = useState<Set<DnsQueryResultLabel>>(
    new Set<DnsQueryResultLabel>(['matched', 'forwarded', 'nxdomain']),
  );
  const visible = useMemo(
    () => (queries ?? []).filter(e => filter.has(e.result)),
    [queries, filter],
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <ErrorCard message={String(error)} />;

  function toggle(r: DnsQueryResultLabel) {
    setFilter(prev => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
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
          <p className="py-8 text-center text-sm text-muted-foreground">표시할 쿼리가 없습니다.</p>
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
                    {new Date(e.ts_unix_ms).toLocaleTimeString()}
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
        <p className="mt-1 text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
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
