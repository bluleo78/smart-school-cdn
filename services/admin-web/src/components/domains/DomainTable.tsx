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
import type { CacheByDomain } from '../../api/cache';

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
  /**
   * 토글 진행 중인 도메인 호스트 집합 — 포함된 행을 모두 disabled 처리한다.
   * 서로 다른 행을 빠르게 연속 클릭해도 모든 in-flight 행이 disabled 유지되도록
   * 단일 host 대신 Set으로 다중 추적한다 (#205, 기존 #162 단일 처리 확장).
   */
  pendingToggleHosts?: Set<string>;
  /**
   * 퍼지 진행 중인 도메인 호스트 집합 — 포함된 행을 모두 disabled 처리한다 (#205).
   */
  pendingPurgeHosts?: Set<string>;
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
  /**
   * 도메인별 캐시 통계 맵 — DomainsPage에서 useCacheStats()로 조회한 by_domain[]을
   * host 기준 Map으로 변환해 전달한다. 맵에 없는 행(요청 0건 등)은 '—'를 유지한다 (#346).
   */
  statsByHost?: Map<string, CacheByDomain>;
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
  pendingToggleHosts,
  pendingPurgeHosts,
  sortKey,
  sortDir,
  onSortChange,
  tlsExpiryByHost,
  statsByHost,
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
            <strong>&ldquo;{searchQuery}&rdquo;</strong>에 일치하는 도메인이 없습니다
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
            {filterLabel} 상태인 도메인이 없습니다
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
          도메인 추가
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
          {/* whitespace-nowrap — iPad portrait(810×1080) 등 좁은 viewport에서 헤더 텍스트가
           *  음절 단위로 세로 wrap되어 헤더 높이가 폭주하는 현상 차단 (#266, #257 동일 패턴) */}
          <TableHead className="text-right whitespace-nowrap">요청(24h)</TableHead>
          <TableHead className="text-right whitespace-nowrap">캐시 히트</TableHead>
          <TableHead className="whitespace-nowrap">TLS</TableHead>
          {/* 이슈 #290 — iPad portrait(810px) 등 좁은 viewport 에서 우측 가로 스크롤로 가려지는 문제 차단.
           *  sticky right-0 + bg-card 로 항상 노출. shadow 로 스크롤 가능 어포던스 제공. */}
          <TableHead className="text-right sticky right-0 bg-card shadow-[-4px_0_4px_-4px_rgba(0,0,0,0.1)]">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domains.map((domain) => {
          const isEnabled = domain.enabled === 1;
          const isSelected = selectedHosts.has(domain.host);
          // 도메인별 캐시 통계 — by_domain[]에서 host 매칭. 데이터가 없으면 '—' 유지 (#346)
          const stat = statsByHost?.get(domain.host);
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
              {/* whitespace-nowrap — 좁은 컬럼(상태 헤더 ~83px)에서 한글 3글자 '비활성'이
               *  음절 단위로 줄바꿈되어 행 높이가 흔들리는 현상 차단 (#257, UsersPage.tsx:245 동일 패턴) */}
              <TableCell className="whitespace-nowrap">
                {/* 비활성 시 outline — DomainDetailHeader·UsersPage와 variant 통일 */}
                <Badge variant={isEnabled ? 'success' : 'outline'}>
                  {isEnabled ? '활성' : '비활성'}
                </Badge>
              </TableCell>

              {/* 요청(24h) — /api/cache/stats by_domain[].requests를 host 매칭으로 표시.
                   데이터가 없으면 '—' 유지. tabular-nums로 자릿수 정렬 안정화 (#346). */}
              <TableCell className="text-right text-xs tabular-nums">
                {stat ? stat.requests.toLocaleString('ko-KR') : <span className="text-muted-foreground">—</span>}
              </TableCell>

              {/* 캐시 히트 — edge_hit_rate(0-1)를 백분율로 표시. 동일 데이터를 Dashboard
                   ByDomainTable이 이미 소비 중 (#346). */}
              <TableCell className="text-right text-xs tabular-nums">
                {stat ? `${(stat.edge_hit_rate * 100).toFixed(1)}%` : <span className="text-muted-foreground">—</span>}
              </TableCell>

              {/* TLS — tlsExpiryByHost에서 도메인별 만료일을 조회해 TlsStatusBadge로 표시한다.
                   맵에 없으면 null(미발급)으로 처리.
                   whitespace-nowrap — 좁은 viewport(iPad portrait)에서 '19일 후 만료' 같은
                   배지 텍스트가 글자 단위로 wrap되어 행 높이가 폭주하는 현상 차단 (#266, #257 동일 패턴) */}
              <TableCell className="whitespace-nowrap">
                <TlsStatusBadge expiresAt={tlsExpiryByHost?.get(domain.host) ?? null} />
              </TableCell>

              {/* 액션 버튼 — shadcn Tooltip으로 감싸 다크모드 대응·즉시 표시 UX 확보.
               *  이슈 #290 — sticky right-0 + bg-card 로 좁은 viewport(iPad portrait 810px)에서도 항상 노출.
               *  shadow-[-4px..] 로 스크롤 가능 어포던스 제공. */}
              <TableCell className="text-right sticky right-0 bg-card shadow-[-4px_0_4px_-4px_rgba(0,0,0,0.1)]">
                <div className="flex items-center justify-end gap-1">
                  {/* 캐시 퍼지 — in-flight 호스트 집합에 포함된 행을 disabled 처리해 중복 클릭 방지 (#162, #205).
                   *  이슈 #353 — header/quick-actions 와 variant 통일 (outline + destructive 컬러). */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => onPurge(domain.host)}
                        disabled={pendingPurgeHosts?.has(domain.host) ?? false}
                        data-testid={`domain-purge-${domain.host}`}
                        aria-label={`${domain.host} 캐시 퍼지`}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>캐시 퍼지</TooltipContent>
                  </Tooltip>

                  {/* 활성/비활성 토글 — in-flight 호스트 집합에 포함된 행을 disabled 처리해 중복/race 차단 (#162, #205) */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onToggle(domain.host)}
                        disabled={pendingToggleHosts?.has(domain.host) ?? false}
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
