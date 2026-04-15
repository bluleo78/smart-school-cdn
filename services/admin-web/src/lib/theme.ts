/** 테마 관리 — localStorage + prefers-color-scheme 연동 */

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';

/** 현재 저장된 테마 설정 반환 */
export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'system';
}

/** 테마 설정 저장 및 적용 */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** 실제 다크 클래스 토글 */
function applyTheme(theme: Theme): void {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', isDark);
}

/** 초기화 — OS 테마 변경 감지 리스너 등록 */
export function initTheme(): void {
  applyTheme(getTheme());

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') {
      applyTheme('system');
    }
  });
}
