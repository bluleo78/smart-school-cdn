/** RequireAuth — 인증 필요 라우트 가드. 미인증 시 /login 또는 /setup 으로 리다이렉트 */
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './use-auth';

/**
 * 보호 라우트 가드 컴포넌트.
 * - loading: 부트스트랩 중 → 스피너 표시
 * - needs_setup: 최초 관리자 미생성 → /setup 강제 이동
 * - needs_login: 인증 만료/미인증 → /login 으로 from 쿼리 보존하여 이동
 * - authenticated: 자식 라우트 렌더링
 */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (state.status === 'needs_setup') return <Navigate to="/setup" replace />;
  if (state.status === 'needs_login') {
    const from = location.pathname + location.search;
    return <Navigate to={`/login?from=${encodeURIComponent(from)}`} replace />;
  }
  return <Outlet />;
}
