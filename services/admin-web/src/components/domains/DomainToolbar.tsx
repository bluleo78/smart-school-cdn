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

  // IME 조합 중에는 debounce/fetch를 트리거하지 않기 위해 별도 상태로 추적한다.
  // onChange 시점의 e.nativeEvent.isComposing은 React 합성 이벤트 처리 순서로 인해
  // compositionend 직후 false로 보일 수 있어, compositionstart/end 이벤트로 직접 관리한다.
  const composingRef = useRef(false);

  // 미완성 자모(예: `ㄱ`, `갂`)가 URL/API 필터에 반영되는 것을 막기 위해
  // IME 조합 중에는 로컬 입력값만 갱신하고 debounce 타이머는 시작하지 않는다 (#189).
  // 동일 패턴: DomainSettingsTab.tsx:140 (편집 폼 IME 가드).
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalInput(value);
      // 표준 가드: e.nativeEvent.isComposing(모던) || keyCode 229(레거시) 또는 ref
      const ne = e.nativeEvent as InputEvent & { keyCode?: number };
      if (composingRef.current || ne.isComposing || ne.keyCode === 229) {
        // 조합 중: 표시값은 갱신했으나 fetch는 보류 — compositionend에서 일괄 트리거
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ ...filter, q: value || undefined });
        setLocalInput(null); // debounce 완료 → 부모 filter에 위임
      }, 300);
    },
    [filter, onFilterChange],
  );

  // IME 조합 시작 — 진행 중 input 이벤트는 fetch 보류
  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  // IME 조합 종료 — 최종 값으로 debounce를 한 번만 트리거하여 검색이 정확히 1회 발사되도록 한다.
  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      const value = e.currentTarget.value;
      setLocalInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange({ ...filter, q: value || undefined });
        setLocalInput(null);
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

  // 모바일(<md)에선 세로 스택, 데스크톱(md+)에선 가로 정렬 — 좁은 화면에서
  // 버튼 라벨이 글자 단위로 줄바꿈되는 현상을 방지한다.
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      {/* 왼쪽: 액션 버튼 — 모바일에선 wrap 허용, 라벨은 nowrap 유지 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={onAddClick}
          data-testid="toolbar-add-btn"
          className="whitespace-nowrap"
        >
          + 도메인 추가
        </Button>
        <Button
          variant="outline"
          onClick={onBulkAddClick}
          className="whitespace-nowrap"
        >
          일괄 추가
        </Button>
        <Button
          variant="outline"
          onClick={onBulkDeleteClick}
          disabled={selectedCount === 0}
          data-testid="toolbar-bulk-delete-btn"
          className="whitespace-nowrap"
        >
          일괄 삭제{selectedCount > 0 && ` (${selectedCount})`}
        </Button>
      </div>

      {/* 오른쪽: 검색 + 필터 — 모바일에선 가용 너비, 데스크톱에선 고정 폭 */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="도메인 검색..."
          value={searchValue}
          onChange={handleSearchChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="w-full md:w-52"
          data-testid="domain-search"
        />
        <Select
          value={filter.enabled === undefined ? 'all' : String(filter.enabled)}
          onValueChange={handleEnabledChange}
        >
          <SelectTrigger
            className="w-28 shrink-0"
            data-testid="domain-enabled-filter"
          >
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
