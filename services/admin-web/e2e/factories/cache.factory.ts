/// 캐시 테스트 데이터 팩토리
import type { CacheStats, CacheEntry } from '../../src/api/cache';

/** 캐시 통계 더미 데이터 생성 */
export function createCacheStats(overrides?: Partial<CacheStats>): CacheStats {
  return {
    hit_count: 750,
    miss_count: 274,
    bypass_count: 0,
    hit_rate: 73.2,
    total_size_bytes: 4_509_715_456,
    max_size_bytes: 21_474_836_480,
    entry_count: 3842,
    by_domain: [
      { domain: 'cdn.textbook.com', hit_count: 500, size_bytes: 3_000_000_000 },
    ],
    hit_rate_history: [
      { timestamp: '2026-04-11T10:00:00Z', hit_rate: 65.0 },
      { timestamp: '2026-04-11T10:01:00Z', hit_rate: 73.2 },
    ],
    ...overrides,
  };
}

/** 인기 콘텐츠 목록 더미 데이터 생성 (2건) */
export function createPopularContent(): CacheEntry[] {
  return [
    {
      url: 'https://cdn.textbook.com/images/cover.png',
      domain: 'cdn.textbook.com',
      content_type: 'image/png',
      size_bytes: 2_097_152,
      hit_count: 412,
      created_at: '2026-04-11T09:00:00Z',
      accessed_at: '2026-04-11T10:01:00Z',
      expires_at: null,
    },
    {
      url: 'https://cdn.textbook.com/assets/chapter1.pdf',
      domain: 'cdn.textbook.com',
      content_type: 'application/pdf',
      size_bytes: 8_806_400,
      hit_count: 387,
      created_at: '2026-04-11T09:00:00Z',
      accessed_at: '2026-04-11T10:00:30Z',
      expires_at: null,
    },
  ];
}
