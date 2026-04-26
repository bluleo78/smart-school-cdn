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
import { Button } from '../ui/button';
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
  /** 빈 상태 CTA — 도메인 추가 모달을 여는 콜백 */
  onAddDomain: () => void;
  /**
   * 현재 적용된 검색어 — 빈 상태 메시지 분기에 사용한다.
   * 검색어가 있으면 "검색 결과 없음", 없으면 "도메인 미등록" CTA를 표시한다.
   */
  searchQuery?: string;
  /** 토글 뮤테이션 진행 중 여부 — 중복 클릭 방지를 위해 버튼을 disabled 처리한다 */
  isTogglePending?: boolean;
  /** 퍼지 뮤테이션 진행 중 여부 — 중복 클릭 방지를 위해 버튼을 disabled 처리한다 */
  isPurgePending?: boolean;
}

export function DomainTable({
  domains,
  isLoading,
  selectedHosts,
  onSelectChange,
  onToggle,
  onPurge,
  onDelete,
  onAddDomain,
  searchQuery,
  isTogglePending = false,
  isPurgePending = false,
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

  // 빈 상태 — 검색어 유무로 두 가지 상황을 분기한다
  // 1) 검색어 있음: "검색 결과 없음" 메시지 표시 (CTA 없음 — 실제 도메인은 존재함)
  // 2) 검색어 없음: 등록된 도메인이 아예 없으므로 추가 유도 CTA 제공
  if (!domains || domains.length === 0) {
    if (searchQuery) {
      return (
        <div
          className="flex flex-col items-center gap-3 py-16 text-muted-foreground"
          data-testid="domains-empty-search"
        >
          <Globe size={40} className="opacity-25" />
          <p className="text-sm font-medium text-foreground">
            <strong>&ldquo;{searchQuery}&rdquo;</strong>에 일치하는 도메인이 없습니다.
          </p>
          <p className="text-xs">검색어를 바꿔 다시 시도해보세요.</p>
        </div>
      );
    }
    return (
      <div
        className="flex flex-col items-center gap-3 py-16 text-muted-foreground"
        data-testid="domains-empty"
      >
        <Globe size={40} className="opacity-25" />
        <p className="text-sm font-medium text-foreground">등록된 도메인이 없습니다</p>
        <p className="text-xs">CDN을 시작하려면 도메인을 추가하세요.</p>
        {/* 첫 방문 사용자가 바로 도메인을 추가할 수 있도록 CTA 제공 */}
        <Button size="sm" onClick={onAddDomain} data-testid="empty-add-domain-btn">
          + 도메인 추가
        </Button>
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
      {/* sticky top-0: Card(overflow-auto)가 스크롤 컨테이너이므로 thead를 고정해 컬럼명 유지 */}
      <TableHeader className="sticky top-0 z-10">
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
          {/* 이슈 #24: "Origin" 영문 → "오리진"으로 한국어 통일 (도메인 상세의 "오리진" 표기와 일관성) */}
          <TableHead>오리진</TableHead>
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
                {/* 비활성 시 outline — DomainDetailHeader·UsersPage와 variant 통일 */}
                <Badge variant={isEnabled ? 'success' : 'outline'}>
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
                  {/* 캐시 퍼지 — isPurgePending 중에는 disabled 처리하여 중복 클릭 방지 */}
                  <button
                    onClick={() => onPurge(domain.host)}
                    disabled={isPurgePending}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="캐시 퍼지"
                    data-testid={`domain-purge-${domain.host}`}
                    aria-label={`${domain.host} 캐시 퍼지`}
                  >
                    <RefreshCw size={14} />
                  </button>

                  {/* 활성/비활성 토글 — isTogglePending 중에는 disabled 처리하여 중복 클릭 방지 */}
                  <button
                    onClick={() => onToggle(domain.host)}
                    disabled={isTogglePending}
                    className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
