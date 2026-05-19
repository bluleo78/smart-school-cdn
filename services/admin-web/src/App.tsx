import { Routes, Route, Navigate, Link } from 'react-router';
import { Suspense, lazy } from 'react';
import { Toaster } from 'sonner';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth } from './components/auth/RequireAuth';
import { RequireSetup } from './components/auth/RequireSetup';
import { RequireUnauth } from './components/auth/RequireUnauth';
import { Skeleton } from './components/ui/skeleton';

// 이슈 #357 — 라우트별 lazy import 로 초기 로딩 청크 분할. 단일 2.6MB 청크 → 라우트별 코드 분할.
// AppLayout / RequireAuth 등 셸 컴포넌트는 즉시 필요하므로 정적 import 유지.
const LoginPage        = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const SetupPage        = lazy(() => import('./pages/SetupPage').then(m => ({ default: m.SetupPage })));
const DashboardPage    = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const DomainsPage      = lazy(() => import('./pages/DomainsPage').then(m => ({ default: m.DomainsPage })));
const DomainDetailPage = lazy(() => import('./pages/DomainDetailPage').then(m => ({ default: m.DomainDetailPage })));
const DnsPage          = lazy(() => import('./pages/DnsPage').then(m => ({ default: m.DnsPage })));
const SystemPage       = lazy(() => import('./pages/SystemPage').then(m => ({ default: m.SystemPage })));
const UsersPage        = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })));

/**
 * E2E 테스트 전용 컴포넌트 — 렌더 시 즉시 예외를 throw한다.
 * ErrorBoundary 동작 검증용으로만 사용하며, DEV 환경에서만 라우트가 활성화된다.
 * null 반환 타입은 throw로 인해 실제로는 도달하지 않지만 TSX 타입 요건을 충족한다.
 */
function ThrowOnRender(): null {
  throw new Error('E2E 테스트용 강제 렌더 오류');
}

/** 404 — 존재하지 않는 경로 접근 시 표시. 대시보드 복귀 CTA 포함.
 *  스크린리더 사용자가 페이지 구조를 인지할 수 있도록 시맨틱 <h2> 헤딩을 노출하고,
 *  큰 "404" 숫자는 시각적 보조용으로 aria-hidden 처리한다. (#180) */
function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <p aria-hidden="true" className="text-4xl font-bold">
        404
      </p>
      <h2 className="text-sm font-medium text-foreground">
        페이지를 찾을 수 없습니다.
      </h2>
      {/* 사용자가 직접 사이드바를 찾지 않아도 홈으로 돌아갈 수 있도록 CTA 제공 */}
      <Link
        to="/"
        className="inline-flex items-center justify-center h-8 px-3 text-sm rounded-md font-medium
          bg-card text-foreground border border-border
          hover:bg-accent hover:text-accent-foreground hover:border-border/70
          transition-all duration-150
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        대시보드로 돌아가기
      </Link>
    </div>
  );
}

/** 페이지 lazy 로딩 fallback — 청크 다운로드 중 카드형 Skeleton 으로 레이아웃 점프 최소화 */
function PageFallback() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function App() {
  return (
    <>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* RequireUnauth 가드 — 이미 로그인된 상태에서 /login 직접 접근 시 리다이렉트 (#291) */}
        <Route element={<RequireUnauth />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>
        {/* RequireSetup 가드 — 이미 설정 완료 상태에서 /setup 직접 접근 시 리다이렉트 (#131) */}
        <Route element={<RequireSetup />}>
          <Route path="/setup" element={<SetupPage />} />
        </Route>

        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="domains" element={<DomainsPage />} />
            <Route path="domains/:host" element={<DomainDetailPage />} />
            <Route path="cache" element={<Navigate to="/domains" replace />} />
            <Route path="optimizer" element={<Navigate to="/domains" replace />} />
            <Route path="dns" element={<DnsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="system" element={<SystemPage />} />
            {/* DEV 전용 라우트 — ErrorBoundary E2E 테스트에서 강제 렌더 오류를 발생시키는 용도 */}
            {import.meta.env.DEV && (
              <Route path="__e2e/throw" element={<ThrowOnRender />} />
            )}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
      {/* 전역 토스트 — bottom-right, 성공=녹색 / 에러=빨강 */}
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
