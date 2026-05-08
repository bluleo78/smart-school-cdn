/**
 * RequireUnauth — /login 라우트 전용 가드.
 * 미인증 상태에서만 자식 컴포넌트(LoginPage)를 렌더링하고,
 * 이미 인증 완료된 사용자가 /login 직접 접근 시 적절한 경로로 리다이렉트한다 (#291).
 *
 * #131의 RequireSetup 가드와 동일 패턴으로 일관성을 맞춘다.
 */
import { Navigate, Outlet, useSearchParams } from 'react-router';
import { useAuth } from './use-auth';

/**
 * /login 라우트 가드 컴포넌트.
 * - loading: 부트스트랩 중 → 스피너 표시 (불필요한 로그인 폼 깜빡임 방지)
 * - needs_login: 정상적으로 로그인이 필요한 상태 → LoginPage 렌더링 허용
 * - needs_setup: 최초 관리자 미생성 → /setup 으로 이동
 * - authenticated: 이미 로그인된 상태 → 폼 노출 차단을 위해 즉시 리다이렉트
 *   ?from 쿼리가 있으면 그 경로(상대 경로 한정, Open Redirect 방지)로, 없으면 / 로 이동.
 */
export function RequireUnauth() {
  const { state } = useAuth();
  const [searchParams] = useSearchParams();

  if (state.status === 'loading') {
    // 부트스트랩 중에는 스피너만 표시 — 인증된 사용자에게 로그인 폼이 잠깐이라도 노출되는 것 방지
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // 미로그인 상태에서만 LoginPage 렌더링 허용
  if (state.status === 'needs_login') return <Outlet />;

  // 최초 셋업 미완료 → /setup 강제 이동
  if (state.status === 'needs_setup') return <Navigate to="/setup" replace />;

  // authenticated — 인증된 사용자는 /login 노출 금지.
  // RequireAuth가 보존한 ?from 쿼리(상대 경로 한정)를 우선하여 자연스러운 흐름 유지,
  // 없으면 메인 대시보드(/)로 이동.
  const rawFrom = searchParams.get('from');
  // Open Redirect 방지: '/'로 시작하면서 '//'(protocol-relative)는 제외
  const from = rawFrom && rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/';
  return <Navigate to={from} replace />;
}
