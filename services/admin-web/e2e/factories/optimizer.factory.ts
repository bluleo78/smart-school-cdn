/// 최적화 테스트 데이터 팩토리
/// E2E 테스트에서 사용할 최적화 프로파일 및 절감 통계 더미 데이터를 생성한다.

/** 최적화 프로파일 목록 생성 (2건) */
export function createProfileList() {
  return [
    { domain: 'textbook.co.kr', quality: 85, max_width: 0, enabled: true },
    { domain: 'static.edunet.net', quality: 70, max_width: 1280, enabled: false },
  ];
}

/** 도메인별 절감 통계 목록 생성 (2건) */
export function createStatsList() {
  return [
    { domain: 'textbook.co.kr', original_bytes: 10_000_000, optimized_bytes: 6_000_000, count: 500 },
    { domain: 'static.edunet.net', original_bytes: 5_000_000, optimized_bytes: 3_200_000, count: 200 },
  ];
}
