/** AuthProvider — 앱 부팅 시 /auth/state 1회 조회로 초기 상태 결정.
 *  login/logout 호출 시 상태 갱신. useAuth 훅은 ./use-auth 에서 별도 export. */
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { fetchAuthState, login as apiLogin, logout as apiLogout } from '../../api/auth';
import { AuthContext, type AuthStatus } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStatus>({ status: 'loading' });

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
    setState({ status: 'needs_login' });
  }, []);

  return (
    <AuthContext.Provider value={{ state, login, logout, refresh }}>{children}</AuthContext.Provider>
  );
}
