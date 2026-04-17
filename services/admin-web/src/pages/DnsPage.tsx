/** DNS 관리 페이지 — 기능 스켈레톤 (디자인 확정 전)
 *  상단 상태 스트립 + 3개 탭(레코드/통계/최근 쿼리).
 *  디자인 시스템(smart-fire-hub) 일관성 작업은 후속 디자이너 세션에서 수행한다. */
import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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

/** 작은 버튼 공통 스타일 — Button 컴포넌트에 size prop 이 없어 className 으로 대체 */
const SMALL_BTN = 'px-3 py-1 text-xs';

/** DNS 관리 페이지 루트 — 오프라인 배너 + 상태 스트립 + 3탭 */
export function DnsPage() {
  const { data: status } = useDnsStatus();
  // status 가 undefined(초기 로드 중)일 땐 배너 표시 금지 — 깜빡임 방지
  const offline = status?.online === false;

  return (
    <div className="space-y-6" data-testid="dns-page">
      {offline && (
        <div
          className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive"
          data-testid="dns-offline-banner"
        >
          <AlertTriangle size={18} />
          <span className="text-sm">DNS 서비스가 오프라인 상태입니다.</span>
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
  if (isLoading || !status) return <Skeleton className="h-12 w-full" />;

  // 직전 분 버킷의 total / 60 으로 QPS 근사 (현재 분은 누적 중이라 저평가되므로 제외)
  const prevMinuteBucket =
    metrics && metrics.length >= 2 ? metrics[metrics.length - 2] : undefined;
  const qpsRecent = prevMinuteBucket ? prevMinuteBucket.total / 60 : 0;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-6 py-3 text-sm">
        <Badge variant={status.online ? 'success' : 'destructive'}>
          {status.online ? '● Online' : '● Offline'}
        </Badge>
        <span>Uptime {formatUptime(status.uptime_secs)}</span>
        <span>Total {status.total.toLocaleString()}</span>
        <span>QPS (직전 1분) {qpsRecent.toFixed(2)}</span>
      </CardContent>
    </Card>
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
      <CardHeader className="flex flex-row items-center justify-between">
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
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 레코드가 없습니다.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.host}>
                  <TableCell className="font-mono">{r.host}</TableCell>
                  <TableCell className="font-mono">{r.target}</TableCell>
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total" value={totals.total} />
        <StatCard label="Matched" value={totals.matched} />
        <StatCard label="Forwarded" value={totals.forwarded} />
        <StatCard label="NXDOMAIN" value={totals.nxdomain} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>쿼리 추이</CardTitle>
          <div className="flex gap-2">
            <Button
              variant={range === '1h' ? 'default' : 'outline'}
              onClick={() => setRange('1h')}
              className={SMALL_BTN}
            >
              1시간
            </Button>
            <Button
              variant={range === '24h' ? 'default' : 'outline'}
              onClick={() => setRange('24h')}
              className={SMALL_BTN}
            >
              24시간
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-72">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={(metrics ?? []).map(b => ({
                  ...b,
                  t: new Date(b.ts).toLocaleTimeString(),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" />
                <YAxis />
                <ChartTooltip />
                <Line type="monotone" dataKey="total" stroke="#6366f1" dot={false} />
                <Line type="monotone" dataKey="matched" stroke="#10b981" dot={false} />
                <Line type="monotone" dataKey="forwarded" stroke="#94a3b8" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top 10 쿼리 도메인 (최근 쿼리 스냅샷)</CardTitle>
        </CardHeader>
        <CardContent>
          {!status || status.top_domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">쿼리가 없습니다.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.top_domains.map((d, i) => (
                  <TableRow key={d.qname}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono">{d.qname}</TableCell>
                    <TableCell>{d.count}</TableCell>
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
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>최근 쿼리 ({visible.length} / {queries?.length ?? 0})</CardTitle>
        <div className="flex gap-2">
          {(['matched', 'forwarded', 'nxdomain'] as DnsQueryResultLabel[]).map(r => (
            <Button
              key={r}
              variant={filter.has(r) ? 'default' : 'outline'}
              onClick={() => toggle(r)}
              className={SMALL_BTN}
              data-testid={`filter-${r}`}
            >
              {r}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((e, i) => (
              <TableRow key={`${e.ts_unix_ms}-${i}`}>
                <TableCell className="font-mono text-xs">
                  {new Date(e.ts_unix_ms).toLocaleTimeString()}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.client_ip}</TableCell>
                <TableCell className="font-mono truncate max-w-[280px]">{e.qname}</TableCell>
                <TableCell>{e.qtype}</TableCell>
                <TableCell><Badge variant={RESULT_VARIANT[e.result]}>{e.result}</Badge></TableCell>
                <TableCell>{(e.latency_us / 1000).toFixed(2)} ms</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** 작은 숫자 카드 — 라벨 + 큰 숫자 */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

/** 에러 발생 시 표시할 공통 카드 */
function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-destructive">
      <CardContent className="py-4 text-sm text-destructive">
        데이터 로드 실패: {message}
      </CardContent>
    </Card>
  );
}
