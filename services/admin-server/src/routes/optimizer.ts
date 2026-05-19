// 최적화 프로파일 + 절감 통계 API 라우트
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { OptimizerClient } from '../grpc/optimizer_client.js';
import type { DomainRepository } from '../db/domain-repo.js';
import { writeRateLimit } from '../rate-limit-config.js';

declare module 'fastify' {
  interface FastifyInstance {
    optimizerClient: OptimizerClient;
  }
}

/**
 * host 입력 정규화 — DNS 호스트네임은 RFC 1035 §2.3.3에 의해 case-insensitive.
 * 다른 `/:host` 라우트(domains.ts/tls.ts)와 동일한 정규화를 적용해 멤버십 조회 키를 일관되게 맞춘다.
 */
function normalizeHost(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * RFC-1123 도메인 형식 검증 정규식 — domains.ts의 DOMAIN_RE와 동일 패턴.
 * 와일드카드(`*.`) 접두 허용. 메타문자/공백/traversal 시퀀스를 모두 거부한다.
 */
const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** PUT /api/optimizer/profiles/:domain 요청 바디 스키마 — zod 로 변경 (#361).
 *  Fastify JSON-Schema 검증은 표준 envelope(#327) 매핑이 적용되지 않아 raw FST_ERR_VALIDATION 응답이
 *  노출됐다. 다른 라우트와 동일하게 zod safeParse 패턴으로 통일. */
const profileBodySchema = z.object({
  quality:   z.number().int().min(1).max(100),
  max_width: z.number().int().min(0).max(65535),
  enabled:   z.boolean(),
}).strict();

/** 라우트 옵션 — domainRepo가 있으면 멤버십(등록 도메인) 검증에 사용 (#309) */
interface OptimizerRouteOptions {
  domainRepo?: DomainRepository;
}

export async function optimizerRoutes(app: FastifyInstance, opts: OptimizerRouteOptions = {}) {
  const { domainRepo } = opts;

  /** 도메인별 최적화 프로파일 목록 조회 */
  app.get('/api/optimizer/profiles', async (_req, reply) => {
    try {
      const result = await app.optimizerClient.getProfiles();
      return reply.send(result);
    } catch {
      return reply.send({ profiles: [] });
    }
  });

  /**
   * 도메인 최적화 프로파일 수정.
   *
   * (#309) :domain path param에 대한 검증 부재로 `../evil`, `<script>...`, `EXAMPLE.COM`,
   * 미등록 도메인 등 비정상 키가 모두 204로 저장되어 orphan profile이 누적됨.
   * domains.ts/tls.ts와 일관되게 다음 검증을 추가:
   *   1) decodeURIComponent + normalizeHost 로 정규화 (trim + lowercase)
   *   2) 정규화 결과가 빈 문자열이거나 DOMAIN_RE에 부합하지 않으면 400
   *   3) domainRepo 주입 시 멤버십 검증 — 등록되지 않은 host는 404
   */
  app.put<{
    Params: { domain: string };
  }>('/api/optimizer/profiles/:domain', { config: writeRateLimit() }, async (req, reply) => {  // #370 throttle
    const domain = normalizeHost(decodeURIComponent(req.params.domain));
    // 형식 검증 — 빈 문자열/메타문자/traversal 거부 (도메인 추가와 동일 메시지)
    if (!domain || !DOMAIN_RE.test(domain)) {
      // 표준 envelope (#327)
      return reply.status(400).send({
        error: 'invalid_domain',
        message: '유효하지 않은 도메인 형식입니다.',
      });
    }
    // body 검증 (#361) — zod safeParse 로 표준 envelope 매핑
    const parsed = profileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? '잘못된 입력입니다.',
        issues: parsed.error.issues,
      });
    }
    // 멤버십 검증 — domainRepo가 주입된 경우에만 활성화 (테스트 호환성 유지)
    if (domainRepo) {
      const found = domainRepo.findByHost(domain);
      if (!found) {
        // 표준 envelope (#327)
        return reply.status(404).send({
          error: 'domain_not_found',
          message: '도메인을 찾을 수 없습니다.',
        });
      }
    }
    const { quality, max_width, enabled } = parsed.data;
    await app.optimizerClient.setProfile({ domain, quality, max_width, enabled });
    return reply.status(204).send();
  });

  /** 도메인별 최적화 절감 통계 조회 — domain 쿼리로 특정 도메인만 필터링 가능 */
  app.get<{ Querystring: { domain?: string } }>('/api/stats/optimization', async (req, reply) => {
    try {
      const result = await app.optimizerClient.getStats();
      const { domain } = req.query;
      if (domain && Array.isArray(result.stats)) {
        return reply.send({ stats: result.stats.filter((s: { domain?: string }) => s.domain === domain) });
      }
      return reply.send(result);
    } catch {
      return reply.send({ stats: [] });
    }
  });
}
