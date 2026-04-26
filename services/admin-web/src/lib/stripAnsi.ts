/// ANSI escape code 제거 유틸리티
/// Rust 서비스가 컬러 출력 모드로 로그를 기록하면 \x1b[33m 등의 escape code가
/// 포함된 채로 admin-server SSE 스트림에 전달된다.
/// LogViewer 등 UI에서 문자 그대로 렌더링되지 않도록 수신 시점에 제거한다.

/**
 * CSI(Control Sequence Introducer) 기반 ANSI escape code 매칭 패턴.
 * RegExp 생성자로 ESC 문자(\x1b)를 삽입 — 리터럴 제어문자는 ESLint no-control-regex 위반이므로
 * String.fromCharCode(27)을 사용해 동적으로 구성한다.
 */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g');

/**
 * 문자열에서 ANSI escape code를 모두 제거한다.
 * @param s - ANSI code가 포함될 수 있는 원본 문자열
 * @returns escape code가 제거된 순수 텍스트
 */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '');
}
