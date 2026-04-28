/// 도메인 목록 툴바 — 추가/일괄 버튼, 검색 + 상태 필터
import { useCallback, useEffect, useRef, useState } from 'react';
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
  // debounce 중인지 추적 — debounce 중이면 로컬 입력값 사용, 아니면 filter.q 사용
  const [localInput, setLocalInput] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unmount 시 pending debounce 타이머를 정리 — stale callback 방지
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // 표시할 값: debounce 중이면 로컬, 아니면 부모 filter에서 파생
  const searchValue = localInput ?? (filter.q ?? '');

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ ...filter, q: value || undefined });
        setLocalInput(null); // debounce 완료 → 부모 filter에 위임
      }, 300);
    },
    [filter, onFilterChange],
  );

  /** 상태 필터 변경 */
  function handleEnabledChange(value: string) {
    onFilterChange({
      ...filter,
      enabled: value === 'all' ? undefined : value === 'true',
    });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      {/* 왼쪽: 액션 버튼 */}
      <div className="flex items-center gap-2">
        <Button onClick={onAddClick} data-testid="toolbar-add-btn">
          + 도메인 추가
        </Button>
        <Button variant="outline" onClick={onBulkAddClick}>
          일괄 추가
        </Button>
        <Button
          variant="outline"
          onClick={onBulkDeleteClick}
          disabled={selectedCount === 0}
          data-testid="toolbar-bulk-delete-btn"
        >
          일괄 삭제{selectedCount > 0 && ` (${selectedCount})`}
        </Button>
      </div>

      {/* 오른쪽: 검색 + 필터 */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="도메인 검색..."
          value={searchValue}
          onChange={handleSearchChange}
          className="w-52"
          data-testid="domain-search"
        />
        <Select
          value={filter.enabled === undefined ? 'all' : String(filter.enabled)}
          onValueChange={handleEnabledChange}
        >
          <SelectTrigger className="w-28" data-testid="domain-enabled-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="true">활성</SelectItem>
            <SelectItem value="false">비활성</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
