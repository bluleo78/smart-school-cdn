import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { App } from './App';
import { AuthProvider } from './components/auth/AuthContext';
import { ErrorBoundary } from './components/error/ErrorBoundary';
import './index.css';
import { initTheme } from './lib/theme';
initTheme();

// 4xx 클라이언트 오류는 재시도해도 결과가 바뀌지 않으므로 retry 차단.
// 5xx/네트워크 오류만 1회 재시도하여 일시 장애에 한해 회복 시도.
// - 401: api 인터셉터가 즉시 /login 리다이렉트하므로 first-try 에서 곧바로 핸들 (#308)
// - 404/400/403 등: 동일 요청 반복은 admin-server 부하·로그 노이즈만 늘리고
//   사용자 토스트/리다이렉트가 ~1초 지연됨
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (failureCount, error) => {
        const status =
          error instanceof AxiosError ? error.response?.status : undefined;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          return false;
        }
        return failureCount < 1;
      },
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
