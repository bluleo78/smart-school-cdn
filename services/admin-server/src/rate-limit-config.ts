/// 이슈 #370 — write API 처리량 throttling 공통 설정.
///
/// 무엇을: @fastify/rate-limit 의 per-route config 를 표준화한 helper.
/// 왜: mutation 라우트(/api/domains, /api/cache/purge, /api/users 등) 가 자동화 스크립트
///    폭주로 다운스트림(proxy/tls/dns) 을 동시 부하시키는 시나리오 차단.
/// 키 전략: 인증 사용자 id 우선, 미인증/internal 은 IP 폴백.
///         같은 운영자가 한 머신에서 다중 탭/스크립트로 폭주해도 한 사용자로 합산되어 제한된다.

import type { FastifyRequest } from 'fastify';

/** 쓰기 액션 표준 — 분당 30회 (per user/IP) */
export const WRITE_LIMIT_PER_MIN = 30;
/** 도메인 추가/proxy test 등 비교적 가벼운 mutation — 분당 60회 */
export const WRITE_LIMIT_BURST_PER_MIN = 60;

/** rate-limit key 생성기 — 인증 사용자 id 우선, 없으면 IP */
function writeRateLimitKey(req: FastifyRequest): string {
  const sub = req.user?.sub;
  if (sub) return `user:${sub}`;
  return `ip:${req.ip}`;
}

/** mutation 라우트에 적용할 표준 rate-limit 설정 */
export function writeRateLimit(maxPerMinute: number = WRITE_LIMIT_PER_MIN) {
  return {
    rateLimit: {
      max: maxPerMinute,
      timeWindow: '1 minute',
      keyGenerator: writeRateLimitKey,
    },
  };
}
