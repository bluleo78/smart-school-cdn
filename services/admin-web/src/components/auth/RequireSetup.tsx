/**
 * RequireSetup — /setup 라우트 전용 가드.
 * setup이 필요한 상태에서만 자식 컴포넌트를 렌더링하고,
 * 이미 인증 완료된 상태에서 /setup 직접 접근 시 적절한 경로로 리다이렉트한다 (#131).
 */
import { Navigate, Outlet } from 'react-router';
import { useAuth } from './use-auth';

/**
 * /setup 라우트 가드 컴포넌트.
 * - loading: 부트스트랩 중 → 스피너 표시
 * - needs_setup: 아직 초기 설정 미완료 → SetupPage 렌더링 허용
 * - needs_login: 이미 setup 완료, 미로그인 상태 → /login 으로 이동
 * - authenticated: 이미 setup 완료, 로그인 상태 → / 로 이동
 */
export function RequireSetup() {
  const { state } = useAuth();

  if (state.status === 'loading') {
    // 부트스트랩 중에는 스피너만 표시하여 불필요한 폼 노출 방지
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // setup이 필요한 상태에서만 SetupPage 렌더링 허용
  if (state.status === 'needs_setup') return <Outlet />;

  // setup이 이미 완료된 상태 — 로그인 여부에 따라 적절한 경로로 리다이렉트
  if (state.status === 'needs_login') return <Navigate to="/login" replace />;

  // authenticated — 메인 대시보드로 이동
  return <Navigate to="/" replace />;
}
