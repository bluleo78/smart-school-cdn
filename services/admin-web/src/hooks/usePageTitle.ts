import { useEffect } from 'react';

/** 페이지 진입 시 document.title 을 설정하는 훅 — WCAG 2.4.2 Page Titled 준수.
 *  label 이 주어지면 "label | Smart School CDN" 형태로, 없으면 "Smart School CDN" 단독으로 설정한다.
 *  AppLayout 외부(LoginPage, SetupPage 등)처럼 AppLayout 의 useEffect 가 실행되지 않는
 *  페이지에서 공통으로 재사용한다. */
export function usePageTitle(label: string) {
  useEffect(() => {
    // 빈 label 이면 기본 타이틀만 표시 (방어 처리)
    document.title = label ? `${label} | Smart School CDN` : 'Smart School CDN';
    return () => {
      // 언마운트 시 타이틀을 기본값으로 복원 — 다음 페이지가 설정하기 전 빈 틈 방지
      document.title = 'Smart School CDN';
    };
  }, [label]);
}
