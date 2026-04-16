import { Routes, Route, Navigate } from 'react-router';
import { Toaster } from 'sonner';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { DomainsPage } from './pages/DomainsPage';
import { DomainDetailPage } from './pages/DomainDetailPage';
import { SystemPage } from './pages/SystemPage';

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <p className="text-4xl font-bold">404</p>
      <p className="text-sm">페이지를 찾을 수 없습니다.</p>
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="domains" element={<DomainsPage />} />
          <Route path="domains/:host" element={<DomainDetailPage />} />
          <Route path="cache" element={<Navigate to="/domains" replace />} />
          <Route path="optimizer" element={<Navigate to="/domains" replace />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      {/* 전역 토스트 — bottom-right, 성공=녹색 / 에러=빨강 */}
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
