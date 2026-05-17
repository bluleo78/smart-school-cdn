/// 값(value)을 지정된 지연(ms) 후에 갱신하는 범용 debounce 훅 (#402)
/// 빠르게 변하는 입력값(예: 검색어·path)을 그대로 TanStack Query의 queryKey 에 사용하면
/// 키 입력마다 fetch가 발사되어 백엔드 fan-in 부하가 키 길이만큼 증폭된다.
/// 본 훅은 입력값이 안정될 때까지 마지막 값만 살려 query/effect 트리거 빈도를 낮춘다.
///
/// 사용 예:
///   const debouncedPath = useDebouncedValue(pathInput, 250);
///   const q = useDomainDiagnose({ host, path: debouncedPath, ... });
import { useEffect, useState } from 'react';

/**
 * @param value     원본(즉시) 값
 * @param delayMs   debounce 지연(ms). 권장 200~300ms (사용자 체감 지연이 적으면서
 *                  연속 타이핑 한 단어 내에서는 한 번만 발사되는 범위)
 * @returns         debounceMs 동안 변경이 없을 때 갱신되는 안정값
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    // 새 value 가 들어올 때마다 타이머를 재시작 — delayMs 동안 추가 변경 없으면 commit.
    // cleanup 으로 pending 타이머를 해제해 stale 값이 뒤늦게 setState 되는 것을 방지.
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
