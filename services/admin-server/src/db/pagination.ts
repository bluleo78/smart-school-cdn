/**
 * DB 페이지네이션 파라미터(limit/offset) 정수화·범위 클램프 헬퍼.
 *
 * 무엇을: 사용자 입력 limit/offset 값을 안전한 정수로 강제 변환한다.
 * 왜:
 *  - better-sqlite3는 `LIMIT 1.7` 같은 비정수 값을 SQL에 그대로 주입하면
 *    SQLITE_MISMATCH(datatype mismatch) 에러를 반환한다 (#293).
 *  - `Math.floor`로 정수화하지 않으면 `Number.isFinite(1.7) === true` 통과 후
 *    `Math.min(Math.max(1.7, 1), 1000)` = 1.7 그대로 SQL에 들어간다.
 *  - 라우트마다 같은 검증을 중복하면 일부만 보호되는 #293 같은 회귀가 재발한다.
 *
 * 정책:
 *  - undefined/null/NaN/Infinity → fallback(default)
 *  - 그 외 → Math.floor 후 [min, max] 범위로 클램프
 */

/** 정수화 + 클램프 옵션 */
export interface ClampIntOptions {
  /** 허용 하한 (포함). 기본 1 */
  min?: number;
  /** 허용 상한 (포함) */
  max: number;
  /** 입력이 invalid(undefined/null/NaN/Infinity)일 때 사용할 기본값 */
  fallback: number;
}

/**
 * 임의 입력값을 정수 + [min,max] 범위로 강제한다.
 * limit/offset처럼 SQL `LIMIT`/`OFFSET`에 직접 들어가는 값 보호용.
 */
export function clampInt(raw: unknown, opts: ClampIntOptions): number {
  const min = opts.min ?? 1;
  // Number(undefined)=NaN, Number(null)=0 — null도 fallback으로 떨구기 위해 별도 분기
  if (raw === undefined || raw === null) return clampOnly(opts.fallback, min, opts.max);
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return clampOnly(opts.fallback, min, opts.max);
  return clampOnly(Math.floor(n), min, opts.max);
}

/**
 * offset 전용 헬퍼 — 음수/비정수 방지 후 [0, max] 범위로 클램프.
 * SQLite는 `OFFSET` 상한이 사실상 없지만 비정상 입력으로 인한 풀스캔을 막기 위해 상한을 둔다.
 */
export function clampOffset(raw: unknown, max: number = 1_000_000): number {
  return clampInt(raw, { min: 0, max, fallback: 0 });
}

/** 내부 — 이미 정수가 보장된 값에 대해 min/max 범위만 강제 */
function clampOnly(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
