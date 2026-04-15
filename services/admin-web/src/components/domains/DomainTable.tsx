/// 도메인 목록 테이블 — 체크박스, 상태 배지, 액션 버튼 포함
import { Link } from 'react-router';
import { Globe, Trash2, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import type { Domain } from '../../api/domain-types';

interface DomainTableProps {
  domains: Domain[] | undefined;
  isLoading: boolean;
  selectedHosts: Set<string>;
  onSelectChange: (hosts: Set<string>) => void;
  onToggle: (host: string) => void;
  onPurge: (host: string) => void;
  onDelete: (host: string) => void;
}

export function DomainTable({
  domains,
  isLoading,
  selectedHosts,
  onSelectChange,
  onToggle,
  onPurge,
  onDelete,
}: DomainTableProps) {
  // 로딩 상태: 5행 스켈레톤
  if (isLoading) {
    return (
      <div className="space-y-2 p-4" data-testid="domains-table-loading">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  // 빈 상태
  if (!domains || domains.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-muted-foreground"
        data-testid="domains-empty"
      >
        <Globe size={40} className="opacity-25" />
        <p className="text-sm">등록된 도메인이 없습니다.</p>
      </div>
    );
  }

  // 전체 선택 체크박스 상태
  const allSelected = domains.length > 0 && domains.every((d) => selectedHosts.has(d.host));
  const someSelected = !allSelected && domains.some((d) => selectedHosts.has(d.host));

  function handleSelectAll(checked: boolean) {
    if (checked) {
      onSelectChange(new Set(domains!.map((d) => d.host)));
    } else {
      onSelectChange(new Set());
    }
  }

  function handleSelectOne(host: string, checked: boolean) {
    const next = new Set(selectedHosts);
    if (checked) next.add(host);
    else next.delete(host);
    onSelectChange(next);
  }

  return (
    <Table data-testid="domains-table">
      <TableHeader>
        <TableRow>
          {/* 전체 선택 체크박스 */}
          <TableHead className="w-10">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="rounded border-border"
              data-testid="domain-select-all"
              aria-label="전체 선택"
            />
          </TableHead>
          <TableHead>도메인</TableHead>
          <TableHead>Origin</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="text-right">요청(24h)</TableHead>
          <TableHead className="text-right">캐시 히트</TableHead>
          <TableHead>TLS</TableHead>
          <TableHead className="text-right">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domains.map((domain) => {
          const isEnabled = domain.enabled === 1;
          const isSelected = selectedHosts.has(domain.host);
          return (
            <TableRow
              key={domain.host}
              className={`${!isEnabled ? 'opacity-50' : ''} ${isSelected ? 'bg-accent/30' : ''}`}
              data-testid={`domain-row-${domain.host}`}
            >
              {/* 체크박스 */}
              <TableCell>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => handleSelectOne(domain.host, e.target.checked)}
                  className="rounded border-border"
                  data-testid={`domain-select-${domain.host}`}
                  aria-label={`${domain.host} 선택`}
                />
              </TableCell>

              {/* 도메인 — 상세 페이지 링크 */}
              <TableCell className="font-mono font-medium">
                <Link
                  to={`/domains/${encodeURIComponent(domain.host)}`}
                  className="hover:text-primary hover:underline"
                  data-testid={`domain-link-${domain.host}`}
                >
                  {domain.host}
                </Link>
              </TableCell>

              {/* Origin */}
              <TableCell className="text-muted-foreground text-xs truncate max-w-[200px]">
                {domain.origin}
              </TableCell>

              {/* 상태 배지 */}
              <TableCell>
                <Badge variant={isEnabled ? 'success' : 'default'}>
                  {isEnabled ? '활성' : '비활성'}
                </Badge>
              </TableCell>

              {/* 요청 24h — 통계 데이터 없으므로 placeholder */}
              <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>

              {/* 캐시 히트 */}
              <TableCell className="text-right text-xs text-muted-foreground">—</TableCell>

              {/* TLS */}
              <TableCell className="text-xs text-muted-foreground">—</TableCell>

              {/* 액션 버튼 */}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {/* 캐시 퍼지 */}
                  <button
                    onClick={() => onPurge(domain.host)}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    title="캐시 퍼지"
                    data-testid={`domain-purge-${domain.host}`}
                    aria-label={`${domain.host} 캐시 퍼지`}
                  >
                    <RefreshCw size={14} />
                  </button>

                  {/* 활성/비활성 토글 */}
                  <button
                    onClick={() => onToggle(domain.host)}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                    title={isEnabled ? '비활성화' : '활성화'}
                    data-testid={`domain-toggle-${domain.host}`}
                    aria-label={`${domain.host} ${isEnabled ? '비활성화' : '활성화'}`}
                  >
                    {isEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  </button>

                  {/* 삭제 */}
                  <button
                    onClick={() => onDelete(domain.host)}
                    className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="삭제"
                    data-testid={`domain-delete-${domain.host}`}
                    aria-label={`${domain.host} 삭제`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
