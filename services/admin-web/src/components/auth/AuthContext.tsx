/** AuthProvider — 앱 부팅 시 /auth/state 1회 조회로 초기 상태 결정.
 *  login/logout 호출 시 상태 갱신. useAuth 훅은 ./use-auth 에서 별도 export.
 *
 *  다중 탭 동기화 (#332): BroadcastChannel('sscdn-auth')로 다른 탭의
 *  logout/user-disabled/password-changed 이벤트를 수신해
 *  - 자기 자신 영향 시 queryClient.clear() + needs_login 전이
 *  - 그 외에는 관련 query만 invalidate
 *  으로 stale UI/affordance 노출을 차단한다.
 */
import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { fetchAuthState, login as apiLogin, logout as apiLogout } from '../../api/auth';
import { AuthContext, type AuthStatus } from './auth-context';
import { broadcastAuthEvent, subscribeAuthEvents } from './auth-broadcast';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStatus>({ status: 'loading' });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // 최신 인증 상태를 ref에 보관 — 브로드캐스트 핸들러가 stale closure 없이
  // 현재 사용자 id를 정확히 비교할 수 있도록 한다. 렌더 중 ref.current 변경은
  // react-hooks/refs 규칙 위반이므로 effect로 동기화.
  const stateRef = useRef<AuthStatus>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchAuthState();
      if (r.state === 'authenticated') setState({ status: 'authenticated', user: r.user });
      else if (r.state === 'needs_setup') setState({ status: 'needs_setup' });
      else setState({ status: 'needs_login' });
    } catch {
      // 네트워크 오류 시 needs_login 으로 폴백 — 로그인 페이지에서 재시도 가능
      setState({ status: 'needs_login' });
    }
  }, []);

  // 부트스트랩 — 마운트 시 1회 상태 조회 (표준 fetch-on-mount 패턴)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const user = await apiLogin(username, password);
    setState({ status: 'authenticated', user });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    // 같은 탭의 react-query 캐시 정리 — 같은 탭에서 곧바로 다른 사용자로 로그인할 때
    // 직전 사용자의 stale 캐시가 새 사용자 화면에 잠시 노출되는 문제를 차단한다 (#341).
    // BroadcastChannel/storage 는 자기 자신을 수신 대상에서 제외하므로,
    // 다른 탭 핸들러(아래 subscribeAuthEvents)와 동일 정책을 자기 탭에도 명시 적용.
    queryClient.clear();
    setState({ status: 'needs_login' });
    // 다른 탭에 로그아웃 신호 브로드캐스트 — 같은 origin/같은 사용자 컨텍스트의
    // 다른 탭도 즉시 needs_login 상태로 전환되도록 한다 (#332).
    broadcastAuthEvent({ type: 'logout' });
  }, [queryClient]);

  // 다중 탭 동기화 구독 (#332)
  // - logout: 무조건 자기 자신도 로그아웃 (서버 세션이 이미 무효화되었으므로 유지 의미 없음)
  // - user-disabled / password-changed: 영향 사용자 id가 자기 자신이면 강제 로그아웃,
  //   그 외에는 사용자 목록 query만 invalidate (관리자 화면 stale 방지)
  useEffect(() => {
    const unsubscribe = subscribeAuthEvents((event) => {
      const current = stateRef.current;
      const myId = current.status === 'authenticated' ? current.user.id : null;

      if (event.type === 'logout') {
        // 같은 origin의 다른 탭이 명시적으로 로그아웃 — 본 탭도 즉시 정리
        queryClient.clear();
        setState({ status: 'needs_login' });
        navigate('/login');
        return;
      }

      if (event.type === 'user-disabled' || event.type === 'password-changed') {
        // 본인이 영향 대상 — 서버에서 세션 무효화가 일어났을 가능성이 높으므로 강제 로그아웃
        if (myId !== null && event.userId === myId) {
          queryClient.clear();
          setState({ status: 'needs_login' });
          navigate('/login');
          return;
        }
        // 본인이 아니면 — 사용자 목록 화면이 열려 있을 수 있으니 관련 query만 무효화
        void queryClient.invalidateQueries({ queryKey: ['users'] });
      }
    });
    return unsubscribe;
  }, [queryClient, navigate]);

  return (
    <AuthContext.Provider value={{ state, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}
