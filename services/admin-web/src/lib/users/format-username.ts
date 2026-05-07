/**
 * Username 표시 가공 헬퍼 (#252)
 *
 * 무엇: admin-server가 대소문자 충돌(#190) 정리 시 loser 행 username을
 *       `__dup_<id>__<원본>` 형태로 영구 보존하는데, 이를 UI에 그대로 노출하면
 *       운영자에게 의미 불명의 문자열로 보여 혼란을 야기한다.
 * 왜:   접두사를 감지해 원본 이메일만 표시하고, 보조 라벨/플래그로 보존된
 *       충돌 항목임을 알린다. 가공은 작은 순수 함수로 추출해 단위 검증 용이.
 *
 * 입력 패턴: `__dup_<숫자>__<원본>` (예: `__dup_3__bluleo78@gmail.com`).
 *  - 숫자가 아닌 경우(e.g. `__dup_abc__x`)는 sentinel로 보지 않고 원문 반환.
 *  - 접두사가 없으면 원문 그대로 반환.
 */

/** 정규식 — `__dup_<숫자>__` 접두사 매칭. capture group 1은 원본 username. */
const DUP_PREFIX_RE = /^__dup_\d+__(.+)$/;

/** 가공 결과 */
export interface FormattedUsername {
  /** 표시용 username — sentinel 접두사 제거된 원본 또는 원문 */
  display: string;
  /** sentinel 접두사가 감지되었는가 — true면 보존된 충돌 항목 */
  isArchivedDuplicate: boolean;
}

/**
 * username sentinel 접두사 제거 + 보존 충돌 여부 판정.
 *
 * @param username admin-server가 내려준 raw username 값
 * @returns 표시용 display + isArchivedDuplicate 플래그
 */
export function formatUsername(username: string): FormattedUsername {
  const match = DUP_PREFIX_RE.exec(username);
  if (match) {
    return { display: match[1], isArchivedDuplicate: true };
  }
  return { display: username, isArchivedDuplicate: false };
}
