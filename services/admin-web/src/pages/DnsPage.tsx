/** DNS 관리 페이지 — 디자인 시스템 일관성 리파인
 *  페이지 헤더 + 상태 스트립 + 3개 탭(레코드/통계/최근 쿼리).
 *  SystemPage / DashboardPage / DomainsPage 와 동일한 shadcn/ui · 시맨틱 토큰 패턴을 따른다. */
import { useMemo, useState } from 'react';
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

/** DNS 관리 페이지 루트 — 헤더 + 오프라인 배너 + 상태 스트립 + 3탭 */
export function DnsPage() {
  const { data: status } = useDnsStatus();
  // status 가 undefined(초기 로드 중)일 땐 배너 표시 금지 — 깜빡임 방지
  const offline = status?.online === false;

  return (
    <div className="space-y-6" data-testid="dns-page">
      {/* 페이지 헤더 — SystemPage / DomainsPage 패턴 */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">DNS</h2>
        <p className="text-sm text-muted-foreground mt-1">
          DNS 서비스 상태, 레코드, 쿼리 통계를 확인합니다.
        </p>
      </div>

      {/* 오프라인 배너 — SystemPage 의 destructive 배너와 동일 스타일 */}
      {offline && (
        <div
          className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive"
          data-testid="dns-offline-banner"
        >
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">DNS 서비스가 오프라인 상태입니다.</p>
            <p className="mt-1 text-sm">서비스 상태를 확인하세요.</p>
          </div>
        </div>
      )}

      <StatusStrip />

      <Tabs defaultValue="records">
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

/** 상단 상태 스트립 — 누적 Total 은 dns-service 기동 이후 기준, QPS 는 직전 1분 기준 */
function StatusStrip() {
  const { data: status, isLoading } = useDnsStatus();
  const { data: metrics } = useDnsMetrics('1h');
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
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>DNS 레코드 ({filtered.length})</CardTitle>
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
          <Table>
            <TableHeader>
              <TableRow>
                {/* 한국어 UI 통일 — 이슈 #19 */}
                <TableHead>호스트</TableHead>
                <TableHead>대상 IP</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>출처</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.host} className="hover:bg-muted/50">
                  <TableCell className="font-mono">{r.host}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{r.target}</TableCell>
                  <TableCell>{r.rtype}</TableCell>
                  <TableCell><Badge variant="outline">{r.source}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** 통계 탭 — 카드 4종 + 범위 토글 + 시계열 차트 + Top 10 */
function StatsTab() {
  const [range, setRange] = useState<DnsMetricRange>('1h');
  const { data: status } = useDnsStatus();
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
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>쿼리 추이</CardTitle>
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
          <CardTitle>Top 10 쿼리 도메인 (최근 쿼리 스냅샷)</CardTitle>
        </CardHeader>
        <CardContent>
          {!status || status.top_domains.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">쿼리가 없습니다.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* 한국어 UI 통일 — 이슈 #19 */}
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>도메인</TableHead>
                  <TableHead className="text-right">횟수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.top_domains.map((d, i) => (
                  <TableRow key={d.qname} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-mono">{d.qname}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {d.count.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>최근 쿼리 ({visible.length} / {queries?.length ?? 0})</CardTitle>
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
          <Table>
            <TableHeader>
              <TableRow>
                {/* 한국어 UI 통일 — 이슈 #19 */}
                <TableHead>시각</TableHead>
                <TableHead>클라이언트</TableHead>
                <TableHead>도메인</TableHead>
                <TableHead>유형</TableHead>
                <TableHead>결과</TableHead>
                <TableHead className="text-right">지연</TableHead>
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
