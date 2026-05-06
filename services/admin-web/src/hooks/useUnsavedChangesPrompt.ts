/**
 * useUnsavedChangesPrompt — 미저장 변경 사항이 있을 때 페이지 이탈을 가드하는 훅.
 *
 * 왜 필요한가?
 * - CDN 어드민의 일부 폼(예: 도메인 오리진 설정)은 잘못 저장되면 캐시 미스/오리진 폭주를
 *   유발할 수 있는 민감 항목이다. 사용자가 입력 도중 다른 페이지로 이동하면 입력값이
 *   소실되고, 어디까지 작업했는지 알 수 없어 데이터 무결성 사고로 이어질 수 있다 (#171).
 *
 * 왜 react-router의 useBlocker를 쓰지 않는가?
 * - useBlocker는 Data Router (createBrowserRouter + RouterProvider)에서만 동작한다.
 *   현재 main.tsx는 BrowserRouter를 사용하므로 useBlocker 호출 시 컨텍스트 에러가 난다.
 * - main.tsx 라우팅 구조 전체를 Data Router로 마이그레이션하는 것은 영향 범위가 크므로,
 *   브라우저 history API를 직접 가드하는 가벼운 훅으로 대체한다.
 *
 * 동작 요약:
 * - SPA 내 이동(pushState/replaceState/popstate): 이동 요청을 즉시 차단하고
 *   `pendingTarget`을 호출 측에 알려준다. 호출 측이 사용자에게 다이얼로그를 띄워
 *   확인을 받으면 `confirmNavigation()`을 호출하여 원래 이동을 재개한다.
 * - 외부 이탈(탭 닫기/새로고침): beforeunload로 브라우저 표준 다이얼로그를 띄운다.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

interface Options {
  /** 가드 활성 여부 — false면 모든 인터셉트가 비활성화된다 */
  isDirty: boolean;
}

/** SPA 이동 요청 정보 — pushState/replaceState/popstate 통합 표현 */
interface PendingNavigation {
  /** 'push' | 'replace' | 'pop' */
  type: 'push' | 'replace' | 'pop';
  /** 이동 대상 URL (path + search + hash). pop의 경우 history가 이미 이동한 위치 */
  url: string;
  /** pushState/replaceState 원래 인자 (재호출 시 사용) */
  args?: Parameters<typeof window.history.pushState>;
}

interface Result {
  /** 차단된 이동 요청 — 이 값이 truthy일 때 호출 측이 확인 다이얼로그를 표시한다 */
  pendingNavigation: PendingNavigation | null;
  /** 사용자가 "떠나기"를 선택했을 때 호출 — 차단된 이동을 재개한다 */
  confirmNavigation: () => void;
  /** 사용자가 "취소"를 선택했을 때 호출 — pending 상태만 해제 (URL 변경 없음) */
  cancelNavigation: () => void;
}

/**
 * 미저장 변경 가드 훅.
 *
 * 패턴 — 글로벌 `history.pushState`/`replaceState`를 마운트 동안만 패치하고
 * `popstate`/`beforeunload` 리스너를 설치한다. 차단된 이동은 React state로 노출하여
 * 호출 측이 자체 AlertDialog를 띄울 수 있도록 한다.
 */
export function useUnsavedChangesPrompt({ isDirty }: Options): Result {
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);

  // useEffect 클로저 외부에서 최신 isDirty/pending을 참조하기 위한 refs
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const pendingRef = useRef<PendingNavigation | null>(null);
  pendingRef.current = pendingNavigation;

  // 원래 history 메서드 보관 — confirmNavigation에서 직접 호출하기 위함
  const originalsRef = useRef<{
    push: typeof window.history.pushState;
    replace: typeof window.history.replaceState;
  } | null>(null);

  useEffect(() => {
    // 가드 적용 시점의 위치 — popstate 취소 시 복원 대상
    const guardedPath = window.location.pathname + window.location.search + window.location.hash;

    // 1) 외부 이탈 가드 — 탭 닫기/새로고침. isDirty 변동을 ref로 매번 확인.
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);

    // 2) SPA 내 이동 가드 — history API 패치
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    originalsRef.current = { push: originalPushState, replace: originalReplaceState };

    function makeInterceptor(
      original: typeof window.history.pushState,
      type: 'push' | 'replace',
    ) {
      return function patched(
        this: History,
        ...args: Parameters<typeof window.history.pushState>
      ) {
        // dirty가 아니면 원래 동작
        if (!isDirtyRef.current) {
          return original.apply(this, args);
        }
        // 이미 다른 pending이 있으면 무시 (중복 클릭 방어)
        if (pendingRef.current) return;
        // 차단 — pending state로 호출 측에 통보
        const targetUrl = typeof args[2] === 'string' ? args[2] : String(args[2] ?? '');
        setPendingNavigation({ type, url: targetUrl, args });
      };
    }
    window.history.pushState = makeInterceptor(originalPushState, 'push') as typeof window.history.pushState;
    window.history.replaceState = makeInterceptor(originalReplaceState, 'replace') as typeof window.history.replaceState;

    // 3) 뒤로가기/앞으로가기 — popstate는 이미 발생한 뒤이므로 즉시 복원하고 pending 표시.
    function handlePopState() {
      if (!isDirtyRef.current) return;
      if (pendingRef.current) return;
      const poppedUrl = window.location.pathname + window.location.search + window.location.hash;
      // URL을 가드 시점으로 즉시 복원 (사용자에게 시각적 흔들림 최소화)
      originalPushState(null, '', guardedPath);
      setPendingNavigation({ type: 'pop', url: poppedUrl });
    }
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      originalsRef.current = null;
    };
    // 의존성은 비워둠 — isDirty 변동은 ref로 처리. 가드는 컴포넌트 라이프타임 동안 유지.
     
  }, []);

  /** 사용자가 "떠나기" 선택 — 차단된 이동을 실제로 수행하고 pending 해제 */
  const confirmNavigation = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending || !originalsRef.current) {
      setPendingNavigation(null);
      return;
    }
    // dirty 가드를 풀어 인터셉터가 재차단하지 않도록 한다
    isDirtyRef.current = false;
    setPendingNavigation(null);

    if (pending.type === 'push' && pending.args) {
      originalsRef.current.push.apply(window.history, pending.args);
      // pushState는 popstate를 발생시키지 않으므로 react-router에 알리기 위해 dispatch
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else if (pending.type === 'replace' && pending.args) {
      originalsRef.current.replace.apply(window.history, pending.args);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else if (pending.type === 'pop') {
      // 사용자가 의도한 이동 위치로 직접 이동
      originalsRef.current.push.call(window.history, null, '', pending.url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  /** 사용자가 "취소" 선택 — pending만 해제, 위치 변경 없음 */
  const cancelNavigation = useCallback(() => {
    setPendingNavigation(null);
  }, []);

  return { pendingNavigation, confirmNavigation, cancelNavigation };
}
