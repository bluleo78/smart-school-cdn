/**
 * 한글 조사 자동 처리 유틸 (#289).
 *
 * 무엇:
 *  - 임의 문자열의 마지막 음절 받침 유무를 판별하여 `을/를`, `이/가`, `은/는`, `와/과`, `(으)로` 등
 *    한글 조사를 자동 선택한다. 다이얼로그/메시지에 사용자 입력값(도메인 호스트·이메일 등)이 들어갈 때
 *    `을(를)` 같은 placeholder 표기를 노출하지 않기 위해 사용한다.
 *
 * 왜:
 *  - "httpbin.org을(를) 삭제하시겠습니까?" 같은 미숙한 카피가 그대로 노출되던 결함을 해결한다.
 *  - 도메인/이메일은 영문·숫자·점(.)이 다수이므로, 한글 외 종료자도 발음 기준으로 받침을 추정한다.
 *
 * 정책:
 *  - 한글 음절: 유니코드 받침 코드(`(code - 0xAC00) % 28 !== 0`)로 판정.
 *  - 영문/숫자/특수: 영문 발음 기준 받침 종료자(예: c, k, l, m, n, p, r, t, 그리고 발음상 받침이 되는 숫자 1/3/6/7/8/0)는 받침으로 처리.
 *  - 단, '.' 같은 구두점이 끝에 오면 그 직전 의미있는 문자로 판정한다 (도메인 끝 dot 케이스 방어).
 */

/** 마지막 의미 있는 문자(공백·구두점 제외)를 반환. */
function lastMeaningfulChar(s: string): string | null {
  const trimmed = s.trim();
  // 끝에서부터 구두점/공백 스킵 — 'example.com.' 같은 trailing dot 방어
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (!/[\s.,;:!?()[\]{}'"`/\\<>|]/.test(ch)) return ch;
  }
  return null;
}

/**
 * 마지막 음절의 받침 여부.
 *
 * - 한글 완성형 음절(가–힣)은 유니코드 공식으로 판정.
 * - 한글 외 종료자는 영문 발음 기준 받침 종료 자모(c, k, l, m, n, p, r, t, x, z 등)와
 *   발음상 받침이 되는 숫자(0=영, 1=일, 3=삼, 6=육, 7=칠, 8=팔)를 받침으로 처리.
 *   2(이)/4(사)/5(오)/9(구)는 받침 없음.
 * - 도메인 케이스(`*.com`, `*.kr`, `*.org`, `*.net`, `*.io` 등) 대부분이 받침으로 끝나도록 보장.
 */
export function hasJongseong(s: string): boolean {
  const last = lastMeaningfulChar(s);
  if (last === null) return false;
  const code = last.charCodeAt(0);
  // 한글 음절 영역
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  // 영문 — 발음상 받침으로 끝나는 자음
  if (/[a-z]/i.test(last)) return /[bcdfghjklmnpqrstxz]/i.test(last);
  // 숫자 — 한국어 발음 기준
  if (/[0-9]/.test(last)) return /[0136780]/.test(last);
  return false;
}

/** `<단어>을` 또는 `<단어>를` 한 글자를 반환. */
export const eulReul = (s: string): '을' | '를' => (hasJongseong(s) ? '을' : '를');

/** `<단어>이` 또는 `<단어>가` 한 글자를 반환. */
export const iGa = (s: string): '이' | '가' => (hasJongseong(s) ? '이' : '가');

/** `<단어>은` 또는 `<단어>는` 한 글자를 반환. */
export const eunNeun = (s: string): '은' | '는' => (hasJongseong(s) ? '은' : '는');

/** `<단어>과` 또는 `<단어>와` 한 글자를 반환. */
export const waGwa = (s: string): '과' | '와' => (hasJongseong(s) ? '과' : '와');
