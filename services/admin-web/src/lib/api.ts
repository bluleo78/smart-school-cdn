/** 공통 axios 인스턴스 — 쿠키 자동 전송 + 401 시 /login 리다이렉트 */
import axios from 'axios';

/**
 * admin-server 표준 에러 응답 envelope (#175)
 * 서버는 모든 비-2xx 응답을 다음 단일 shape 으로 반환한다:
 *   { error: '<machine_code>', message?: '<사용자 표시용>', issues?: unknown[] }
 * 단, 라우트 핸들러는 점진적으로 통일되므로 일부 응답은 아직 message 필드가 없을 수 있다.
 */
export type ApiError = {
  error?: string;
  message?: string;
  issues?: unknown[];
};

/**
 * Axios 에러 객체에서 admin-server 표준 envelope 을 추출한다.
 * - 머신 코드(`error`)는 클라이언트 분기 용도
 * - 사람 표시 메시지(`message`)가 있으면 우선 사용, 없으면 `error` 자체를 fallback
 *
 * @example
 *   const { code, message } = getApiError(err);
 *   if (code === 'invalid_credentials') ...
 */
export function getApiError(err: unknown): { code?: string; message?: string; issues?: unknown[] } {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: ApiError } }).response?.data;
    if (data && typeof data === 'object') {
      return {
        code: typeof data.error === 'string' ? data.error : undefined,
        message: typeof data.message === 'string' ? data.message : undefined,
        issues: Array.isArray(data.issues) ? data.issues : undefined,
      };
    }
  }
  return {};
}

// 기본 axios 인스턴스 — 모든 admin API 요청은 이 인스턴스를 사용한다.
// withCredentials: true → JWT HttpOnly 쿠키 자동 전송
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// 401 응답 인터셉터 — 인증이 끊긴 경우 로그인 페이지로 리다이렉트
// 단, /auth/* 엔드포인트의 401 은 로그인 실패 등 정상 흐름이므로 제외
api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error.response?.status;
    const url: string = error.config?.url ?? '';
    if (status === 401 && !url.includes('/auth/')) {
      const from = window.location.pathname + window.location.search;
      window.location.href = `/login?from=${encodeURIComponent(from)}`;
    }
    return Promise.reject(error);
  },
);
