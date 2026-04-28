/// 도메인 목록 테이블 — 체크박스, 상태 배지, TLS 배지, 액션 버튼 포함
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
import { TlsStatusBadge } from '../TlsStatusBadge';
// 아이콘 전용 버튼에 shadcn Tooltip 적용 — native title 대비 다크모드 대응·즉시 표시 등 UX 개선
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
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
  /**
   * 현재 적용된 활성 상태 필터 — 빈 상태 메시지 분기에 사용한다.
   * true(활성)/false(비활성) 필터가 적용된 경우 "조건에 맞는 도메인 없음"을 표시한다.
   * undefined이면 필터 미적용 상태로 간주한다.
   */
  enabledFilter?: boolean;
  /**
   * 검색 결과 없음 빈 상태의 CTA — 검색어를 지우고 전체 목록으로 돌아가는 콜백.
   * 제공하지 않으면 CTA 버튼을 렌더링하지 않는다.
   */
  onClearSearch?: () => void;
  /**
   * 필터 결과 없음 빈 상태의 CTA — 상태 필터를 해제하고 전체 목록으로 돌아가는 콜백.
   * 제공하지 않으면 CTA 버튼을 렌더링하지 않는다.
   */
  onClearFilter?: () => void;
  /** 토글 진행 중인 도메인 호스트 — 해당 행만 disabled 처리한다 (#162) */
  pendingToggleHost?: string | null;
  /** 퍼지 진행 중인 도메인 호스트 — 해당 행만 disabled 처리한다 (#162) */
  pendingPurgeHost?: string | null;
  /**
   * 현재 정렬 기준 컬럼 — 정렬 헤더 강조·aria-sort 표시에 사용한다.
   * 현재 정렬 가능 컬럼: 'host' (도메인명 오름/내림차순)
   */
  sortKey?: string;
  /** 현재 정렬 방향 */
  sortDir?: 'asc' | 'desc';
  /** 헤더 클릭 시 정렬 컬럼·방향 변경 콜백 — 같은 컬럼을 다시 클릭하면 방향이 토글된다 */
  onSortChange?: (key: string, dir: 'asc' | 'desc') => void;
  /**
   * 도메인별 TLS 인증서 만료일 맵 — DomainsPage에서 useCertificates()로 조회한 결과를 전달한다.
   * 맵에 없는 도메인은 TlsStatusBadge가 null(미발급)로 처리한다.
   */
  tlsExpiryByHost?: Map<string, string>;
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
  enabledFilter,
  onClearSearch,
  onClearFilter,
  pendingToggleHost = null,
  pendingPurgeHost = null,
  sortKey,
  sortDir,
  onSortChange,
  tlsExpiryByHost,
}: DomainTableProps) {
  /**
   * 컬럼 헤더 클릭 핸들러 — 같은 컬럼이면 방향 토글, 다른 컬럼이면 asc 시작
   * onSortChange가 없으면 (정렬 불가 컬럼) 아무 동작도 하지 않는다
   */
  function handleSort(key: string) {
    if (!onSortChange) return;
    if (sortKey === key) {
      onSortChange(key, sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(key, 'asc');
    }
  }
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

  // 빈 상태 — 검색어·상태 필터 유무로 세 가지 상황을 분기한다
  // 1) 검색어 있음: "검색 결과 없음" 메시지 + 검색 초기화 CTA (#126)
  // 2) 상태 필터(활성/비활성) 적용됨: "조건에 맞는 도메인 없음" + 필터 해제 CTA (#126)
  //    → 실제 도메인은 존재하지만 필터 조건에 해당하는 것이 없는 상황이므로
  //      "등록된 도메인이 없습니다" CTA를 표시하면 오해를 준다 (이슈 #95)
  // 3) 필터 없음: 등록된 도메인이 아예 없으므로 추가 유도 CTA 제공
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
          {/* 검색 초기화 CTA — 클릭 시 검색어를 지워 전체 목록으로 돌아간다 (#126) */}
          {onClearSearch && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearSearch}
              data-testid="empty-clear-search-btn"
            >
              검색어 지우기
            </Button>
          )}
        </div>
      );
    }
    if (enabledFilter !== undefined) {
      // 상태 필터가 적용된 경우 — 필터 조건에 맞는 도메인이 없음을 안내한다
      const filterLabel = enabledFilter ? '활성' : '비활성';
      return (
        <div
          className="flex flex-col items-center gap-3 py-16 text-muted-foreground"
          data-testid="domains-empty-filter"
        >
          <Globe size={40} className="opacity-25" />
          <p className="text-sm font-medium text-foreground">
            {filterLabel} 상태인 도메인이 없습니다.
          </p>
          <p className="text-xs">필터를 변경하거나 해제해 보세요.</p>
          {/* 필터 해제 CTA — 클릭 시 상태 필터를 해제하여 전체 목록으로 돌아간다 (#126) */}
          {onClearFilter && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearFilter}
              data-testid="empty-clear-filter-btn"
            >
              전체 보기
            </Button>
          )}
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
          {/* 도메인 컬럼 — host 기준 정렬 지원. 클릭 시 asc/desc 토글, aria-sort로 현재 방향 표현 */}
          <TableHead
            className={onSortChange ? 'cursor-pointer select-none hover:text-foreground' : ''}
            onClick={() => handleSort('host')}
            aria-sort={
              sortKey === 'host'
                ? sortDir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none'
            }
            data-testid="domain-col-host"
          >
            도메인{' '}
            {sortKey === 'host' && (
              <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
            )}
          </TableHead>
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

              {/* TLS — tlsExpiryByHost에서 도메인별 만료일을 조회해 TlsStatusBadge로 표시한다.
                   맵에 없으면 null(미발급)으로 처리 */}
              <TableCell>
                <TlsStatusBadge expiresAt={tlsExpiryByHost?.get(domain.host) ?? null} />
              </TableCell>

              {/* 액션 버튼 — shadcn Tooltip으로 감싸 다크모드 대응·즉시 표시 UX 확보 */}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {/* 캐시 퍼지 — pendingPurgeHost 행만 disabled 처리하여 중복 클릭 방지 (#162) */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onPurge(domain.host)}
                        disabled={pendingPurgeHost === domain.host}
                        data-testid={`domain-purge-${domain.host}`}
                        aria-label={`${domain.host} 캐시 퍼지`}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>캐시 퍼지</TooltipContent>
                  </Tooltip>

                  {/* 활성/비활성 토글 — pendingToggleHost 행만 disabled 처리하여 중복 클릭 방지 (#162) */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onToggle(domain.host)}
                        disabled={pendingToggleHost === domain.host}
                        data-testid={`domain-toggle-${domain.host}`}
                        aria-label={`${domain.host} ${isEnabled ? '비활성화' : '활성화'}`}
                      >
                        {isEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isEnabled ? '비활성화' : '활성화'}</TooltipContent>
                  </Tooltip>

                  {/* 삭제 — hover:text-destructive 유지 */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-destructive hover:bg-destructive/10"
                        onClick={() => onDelete(domain.host)}
                        data-testid={`domain-delete-${domain.host}`}
                        aria-label={`${domain.host} 삭제`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>삭제</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
