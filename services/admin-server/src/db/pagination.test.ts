import { describe, it, expect } from 'vitest';
import { clampInt, clampOffset } from './pagination.js';

// 페이지네이션 정수화 헬퍼 테스트 — #293 회귀 방지용
describe('clampInt', () => {
  const opts = { min: 1, max: 1000, fallback: 100 };

  it('비정수 양수 입력을 floor로 정수화한다 (#293 핵심 케이스)', () => {
    expect(clampInt(1.7, opts)).toBe(1);
    expect(clampInt(2.5, opts)).toBe(2);
    expect(clampInt(3.14, opts)).toBe(3);
  });

  it('문자열 형태의 숫자도 정수화한다', () => {
    expect(clampInt('1.7', opts)).toBe(1);
    expect(clampInt('500', opts)).toBe(500);
  });

  it('하한 미만은 min으로 클램프한다', () => {
    expect(clampInt(0, opts)).toBe(1);
    expect(clampInt(-5, opts)).toBe(1);
    expect(clampInt(0.5, opts)).toBe(1); // floor(0.5)=0 → clamp to 1
  });

  it('상한 초과는 max로 클램프한다', () => {
    expect(clampInt(99999, opts)).toBe(1000);
    expect(clampInt(1500.9, opts)).toBe(1000);
  });

  it('undefined/null/NaN/Infinity는 fallback을 사용한다', () => {
    expect(clampInt(undefined, opts)).toBe(100);
    expect(clampInt(null, opts)).toBe(100);
    expect(clampInt(NaN, opts)).toBe(100);
    expect(clampInt(Infinity, opts)).toBe(100);
    expect(clampInt(-Infinity, opts)).toBe(100);
  });

  it('파싱 불가 문자열은 fallback을 사용한다', () => {
    expect(clampInt('abc', opts)).toBe(100);
    // 빈 문자열은 Number('')===0 → finite로 인식되어 min(1)으로 클램프된다.
    // 실질적으로 안전한 결과(SQL injection·SQLITE_MISMATCH 모두 차단)이므로 허용.
    expect(clampInt('', opts)).toBe(1);
  });

  it('반환값은 항상 정수다 (SQL LIMIT 안전성 보장)', () => {
    const inputs = [1.1, 1.9, '7.5', 100.999, '50.5'];
    for (const i of inputs) {
      expect(Number.isInteger(clampInt(i, opts))).toBe(true);
    }
  });
});

describe('clampOffset', () => {
  it('음수/비정수를 0 이상의 정수로 강제한다', () => {
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset(2.7)).toBe(2);
    expect(clampOffset(undefined)).toBe(0);
  });

  it('상한을 초과하면 max로 클램프한다', () => {
    expect(clampOffset(2_000_000)).toBe(1_000_000);
  });
});
