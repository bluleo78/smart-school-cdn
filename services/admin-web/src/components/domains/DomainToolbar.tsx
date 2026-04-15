/// 도메인 목록 툴바 — 추가/일괄 버튼, 검색 + 상태 필터
import { useCallback, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import type { DomainsFilter } from '../../api/domain-types';

interface DomainToolbarProps {
  filter: DomainsFilter;
  onFilterChange: (f: DomainsFilter) => void;
  selectedCount: number;
  onAddClick: () => void;
  onBulkAddClick: () => void;
  onBulkDeleteClick: () => void;
}

export function DomainToolbar({
  filter,
  onFilterChange,
  selectedCount,
  onAddClick,
  onBulkAddClick,
  onBulkDeleteClick,
}: DomainToolbarProps) {
  // 검색 입력값은 로컬 상태로 관리, 300ms debounce 후 부모에 전달
  const [searchValue, setSearchValue] = useState(filter.q ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // filter.q 가 외부에서 리셋될 경우 동기화
  const filterQ = filter.q ?? '';
  if (searchValue !== filterQ && filterQ === '') {
    setSearchValue('');
  }

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ ...filter, q: value || undefined });
      }, 300);
    },
    [filter, onFilterChange],
  );

  const handleStatusChange = useCallback(
    (value: string) => {
      const enabled =
        value === 'active' ? true : value === 'inactive' ? false : undefined;
      onFilterChange({ ...filter, enabled });
    },
    [filter, onFilterChange],
  );

  // 현재 상태 Select 값 계산
  const statusValue =
    filter.enabled === true ? 'active' : filter.enabled === false ? 'inactive' : 'all';

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      {/* 왼쪽: 액션 버튼 */}
      <div className="flex items-center gap-2">
        <Button onClick={onAddClick} data-testid="toolbar-add-btn">
          + 도메인 추가
        </Button>
        <Button variant="outline" onClick={onBulkAddClick} data-testid="toolbar-bulk-add-btn">
          일괄 추가
        </Button>
        <Button
          variant="outline"
          onClick={onBulkDeleteClick}
          disabled={selectedCount === 0}
          data-testid="toolbar-bulk-delete-btn"
        >
          일괄 삭제{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
      </div>

      {/* 오른쪽: 검색 + 상태 필터 */}
      <div className="flex items-center gap-2">
        <Input
          value={searchValue}
          onChange={handleSearchChange}
          placeholder="도메인 검색…"
          className="w-52"
          data-testid="domain-search"
        />
        <Select value={statusValue} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-28" data-testid="domain-status-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="active">활성</SelectItem>
            <SelectItem value="inactive">비활성</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
