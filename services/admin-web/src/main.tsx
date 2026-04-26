import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './components/auth/AuthContext';
import { ErrorBoundary } from './components/error/ErrorBoundary';
import './index.css';
import { initTheme } from './lib/theme';
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 전역 ErrorBoundary — QueryClientProvider/BrowserRouter 포함 전체 트리를 감싸
        어디서든 렌더 예외가 발생해도 화이트스크린 대신 안내 폴백을 표시한다 */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
