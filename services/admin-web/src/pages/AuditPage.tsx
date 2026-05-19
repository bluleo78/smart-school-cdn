/// 이슈 #351 — 감사 로그 조회 페이지.
/// action/actor/기간 필터 + 페이지네이션. before/after JSON 은 monospace 로 표시.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { fetchAudit, type AuditEntry } from '../api/audit';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui/table';

const PAGE_SIZE = 50;

export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get('action') ?? '';
  const targetType = searchParams.get('target_type') ?? '';
  const pageParam = Number(searchParams.get('page'));
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', action, targetType, page],
    queryFn: () => fetchAudit({
      action:      action || undefined,
      target_type: targetType || undefined,
      limit:       PAGE_SIZE,
      offset,
    }),
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function updateParam(name: string, value: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (value) p.set(name, value);
      else p.delete(name);
      // 필터 변경 시 페이지 리셋
      if (name !== 'page') p.delete('page');
      return p;
    }, { replace: true });
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">감사 로그</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          관리자 액션 (도메인/사용자/캐시 변경) 의 추적 가능한 기록입니다.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <Input
          type="search"
          value={action}
          onChange={(e) => updateParam('action', e.target.value)}
          placeholder="action 필터 (예: domain.create)"
          className="md:max-w-xs"
          data-testid="audit-action-input"
        />
        <Input
          type="search"
          value={targetType}
          onChange={(e) => updateParam('target_type', e.target.value)}
          placeholder="대상 타입 필터 (domain | user | cache)"
          className="md:max-w-xs"
          data-testid="audit-target-input"
        />
        <div className="md:ml-auto text-xs text-muted-foreground">
          총 <span data-testid="audit-total">{total}</span>건
        </div>
      </div>

      <Card className="flex-1 overflow-auto">
        <CardHeader><CardTitle>최근 액션</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {isError && (
            <p className="py-8 text-center text-sm text-muted-foreground">감사 로그를 불러오지 못했습니다.</p>
          )}
          {!isLoading && !isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">시각</TableHead>
                  <TableHead className="whitespace-nowrap">작업자</TableHead>
                  <TableHead className="whitespace-nowrap">action</TableHead>
                  <TableHead className="whitespace-nowrap">대상</TableHead>
                  <TableHead>변경 내용</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                      기록된 액션이 없습니다.
                    </TableCell>
                  </TableRow>
                ) : rows.map((r) => <AuditRow key={r.id} r={r} />)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1}
                  onClick={() => updateParam('page', String(page - 1))}
                  data-testid="audit-page-prev">
            이전
          </Button>
          <span className="text-muted-foreground" data-testid="audit-page-indicator">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages}
                  onClick={() => updateParam('page', String(page + 1))}
                  data-testid="audit-page-next">
            다음
          </Button>
        </div>
      )}
    </div>
  );
}

function AuditRow({ r }: { r: AuditEntry }) {
  const when = new Date(r.created_at * 1000).toLocaleString('ko-KR');
  const diff = r.before || r.after
    ? JSON.stringify({ before: r.before ?? undefined, after: r.after ?? undefined })
    : '';
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{when}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {r.actor_user_id ? `#${r.actor_user_id}` : '—'}
        {r.actor_ip && <span className="text-muted-foreground ml-1">({r.actor_ip})</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">{r.action}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {r.target_type}{r.target_id ? `:${r.target_id}` : ''}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-md">
        {diff}
      </TableCell>
    </TableRow>
  );
}
