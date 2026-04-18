/// 캐시 테스트 데이터 팩토리 — 재설계 후 L1/L2/bypass 분리 shape
import type { CacheStats, CacheSeriesBucket, CacheEntry } from '../../src/api/cache';

/** 재설계된 CacheStats 응답 픽스처 */
export function createCacheStats(overrides: Partial<{
  requests: number;
  l1_hits: number;
  l2_hits: number;
  miss: number;
  bypass_total: number;
  disk: { used_bytes: number; max_bytes: number; entry_count: number };
  by_domain: CacheStats['by_domain'];
}> = {}): CacheStats {
  const req = overrides.requests ?? 1000;
  const l1 = overrides.l1_hits ?? 700;
  const l2 = overrides.l2_hits ?? 100;
  const miss = overrides.miss ?? 150;
  const bypassTotal = overrides.bypass_total ?? 50;
  return {
    requests: req,
    l1_hits: l1,
    l2_hits: l2,
    miss,
    bypass: { method: bypassTotal, nocache: 0, size: 0, other: 0, total: bypassTotal },
    l1_hit_rate: l1 / req,
    edge_hit_rate: (l1 + l2) / req,
    bypass_rate: bypassTotal / req,
    disk: overrides.disk ?? {
      used_bytes: 1024 * 1024,
      max_bytes: 20 * 1024 ** 3,
      entry_count: 42,
    },
    by_domain: overrides.by_domain ?? [
      {
        host: 'a.test',
        requests: 600,
        l1_hits: 500,
        l2_hits: 50,
        bypass_total: 20,
        l1_hit_rate: 500 / 600,
        edge_hit_rate: 550 / 600,
      },
      {
        host: 'b.test',
        requests: 400,
        l1_hits: 200,
        l2_hits: 50,
        bypass_total: 30,
        l1_hit_rate: 200 / 400,
        edge_hit_rate: 250 / 400,
      },
    ],
  };
}

/** 시계열 버킷 픽스처 (2버킷) */
export function createCacheSeriesBuckets(): CacheSeriesBucket[] {
  const now = Date.now();
  return [
    { ts: now - 120_000, l1_hits: 50, l2_hits: 5, miss: 10, bypass: 5 },
    { ts: now - 60_000,  l1_hits: 70, l2_hits: 5, miss: 10, bypass: 5 },
  ];
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
