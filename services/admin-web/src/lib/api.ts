/** 공통 axios 인스턴스 — 쿠키 자동 전송 + 401 시 /login 리다이렉트 */
import axios from 'axios';

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
