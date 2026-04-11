import { Routes, Route } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { DomainsPage } from './pages/DomainsPage';
import { CachePage } from './pages/CachePage';
import { OptimizerPage } from './pages/OptimizerPage';
import { SystemPage } from './pages/SystemPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="domains" element={<DomainsPage />} />
        <Route path="cache" element={<CachePage />} />
        <Route path="optimizer" element={<OptimizerPage />} />
        <Route path="system" element={<SystemPage />} />
      </Route>
    </Routes>
  );
}
