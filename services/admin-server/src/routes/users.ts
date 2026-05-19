import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserRepository } from '../db/user-repo.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signSessionToken, SESSION_COOKIE_NAME, buildSessionCookieOptions } from '../auth/jwt.js';
import { writeRateLimit } from '../rate-limit-config.js';

// Task 4 와 동일한 permissive email 검증 — z.string().email() 의 strict 정책은
// 단일 문자 TLD(예: a@b.c)를 거부해 내부망 호환성/테스트가 깨진다.
const EMAIL_LIKE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// username 입력 정규화 — 이메일 RFC 5321 도메인부 case-insensitive + 실무 관행상
// local-part 까지 lower-casing. 같은 사람이 대소문자만 다른 별도 계정을 만들 수
// 없도록 모든 입력 경계에서 동일 규칙을 적용한다 (#190).
function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

const createSchema = z.object({
  username: z.string().regex(EMAIL_LIKE_RE).max(254).transform(normalizeUsername),
  password: z.string().min(8).max(256),
});

// 자기 자신 비밀번호 변경 시: currentPassword 필수. 다른 사용자 변경 시: 불필요.
// discriminatedUnion 대신 단일 스키마로 받고 핸들러에서 분기한다.
const passwordSchema = z.object({
  password: z.string().min(8).max(256),
  currentPassword: z.string().min(1).max(256).optional(),
});

// path param `:id` 검증 — 비숫자/오버플로우/음수/0/소수가 들어오면 NaN 또는
// 부정확한 정수로 변환되어 user_not_found(404)에 가려지던 문제(#325) 방지.
// `^\d+$` 로 양의 정수 문자열만 허용 후 `Number.isSafeInteger` 로 안전 정수
// 범위(2^53-1) 내 + 1 이상만 통과시킨다.
const userIdSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((v) => Number(v))
  .refine((n) => Number.isSafeInteger(n) && n >= 1, { message: 'invalid_user_id' });

/**
 * users 라우트 공용 :id 파서 — 검증 실패 시 400 invalid_input 응답을 직접
 * 보내고 null 을 반환한다. 호출 측은 null 이면 즉시 return 해야 한다.
 */
function parseUserId(raw: string, reply: import('fastify').FastifyReply): number | null {
  const parsed = userIdSchema.safeParse(raw);
  if (!parsed.success) {
    reply.code(400).send({ error: 'invalid_input' });
    return null;
  }
  return parsed.data;
}

/**
 * users 행 → 공개 응답 직렬화 (#342, #377).
 *
 * 무엇을: password_hash 제외 + *_at 필드를 그대로 전달.
 * 왜: #377 이후 DB 컬럼이 이미 INTEGER unix-sec 라 별도 변환이 불필요.
 *    (이전에는 TEXT ISO → unix-sec 변환을 응답 단에서 수행했다.)
 */
function publicUser(u: {
  id: number; username: string; created_at: number; updated_at: number;
  disabled_at: number | null; last_login_at: number | null;
}) {
  return {
    id: u.id,
    username: u.username,
    created_at: u.created_at,
    updated_at: u.updated_at,
    disabled_at: u.disabled_at,
    last_login_at: u.last_login_at,
  };
}

/**
 * 사용자 CRUD 라우트 — 모두 requireAuth 훅의 보호를 받는다.
 * - GET    /api/users               — 전체 목록 (password_hash 제외)
 * - POST   /api/users               — 신규 생성
 * - PUT    /api/users/:id/password  — 비밀번호 변경
 * - PUT    /api/users/:id/enable    — 비활성 사용자 재활성화
 * - DELETE /api/users/:id           — 비활성(soft delete), 자기 자신은 거부
 */
// GET /api/users 정렬 화이트리스트 — repo USER_SORT_WHITELIST 와 일치 유지 (#344).
// 도메인 라우트(#295) 와 동일하게 라우트 레이어에서도 strict 검증하여 다중 방어.
const SORT_ALLOWED  = new Set(['id', 'username', 'created_at', 'updated_at', 'last_login_at']);
const ORDER_ALLOWED = new Set(['asc', 'desc']);

/**
 * better-sqlite3 SqliteError 중 username UNIQUE 제약 위반인지 판별 (#207).
 *
 * 무엇을: throw 된 객체가 SqliteError 의 UNIQUE 위반 케이스인지 type-narrowing 한다.
 * 왜: better-sqlite3 의 SqliteError 는 export 되어도 `instanceof` 비교가 ESM/CJS
 *     빌드 차이에 따라 흔들리는 사례가 보고되어 있어, `code` 문자열 매칭이 가장
 *     이식성 높은 판별 방식이다 (Node sqlite3 와 동일 표준 코드 `SQLITE_CONSTRAINT_UNIQUE`).
 *     향후 다른 UNIQUE 컬럼이 추가되더라도, 이 라우트의 INSERT 가 users.username 만
 *     건드리므로 UNIQUE 위반 = username 충돌이라는 invariant 가 유지된다.
 */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export const usersRoutes: FastifyPluginAsync<{ userRepo: UserRepository }> = async (app, opts) => {
  const { userRepo } = opts;

  // GET /api/users — 기본 정렬은 created_at DESC (도메인·이벤트와 일관, #344).
  // 명시적 sort/order 쿼리가 있으면 화이트리스트 검증 후 그것을 우선 사용.
  app.get<{ Querystring: { sort?: string; order?: string } }>('/api/users', async (req, reply) => {
    const { sort, order } = req.query;
    if (sort !== undefined && !SORT_ALLOWED.has(sort)) {
      // 표준 envelope (#329) — 도메인 라우트와 동일한 메시지 패턴
      return reply.code(400).send({
        error: 'invalid_input',
        message: `sort는 id|username|created_at|updated_at|last_login_at 중 하나여야 합니다 (받은 값: "${sort}").`,
      });
    }
    if (order !== undefined && !ORDER_ALLOWED.has(order.toLowerCase())) {
      return reply.code(400).send({
        error: 'invalid_input',
        message: `order는 asc|desc 중 하나여야 합니다 (받은 값: "${order}").`,
      });
    }
    return userRepo.list({ sort, order }).map(publicUser);
  });

  app.post('/api/users', { config: writeRateLimit() }, async (req, reply) => {  // #370 throttle
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    // 사전 조회로 1차 차단 — 직렬 호출 시는 여기서 409 응답하여 빠른 경로 유지.
    if (userRepo.findByUsername(parsed.data.username)) {
      return reply.code(409).send({ error: 'username_already_exists' });
    }
    const hash = await hashPassword(parsed.data.password);
    // 동시 요청 race (#207) — 두 요청이 findByUsername 을 통과한 뒤 INSERT 단계에서
    // SQLite UNIQUE 제약을 위반할 수 있다. 사전 조회만으로는 원자적 차단이 불가능하므로
    // INSERT 단계의 UNIQUE 위반을 잡아 표준 409 응답으로 매핑한다 (raw SQL 에러 메시지가
    // error-handler 의 500 internal_error 로 노출되어 클라이언트로 전달되는 정보 누출
    // 및 상태 코드 일관성 깨짐을 방지).
    try {
      const u = userRepo.create(parsed.data.username, hash);
      return reply.code(201).send(publicUser(u));
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.code(409).send({ error: 'username_already_exists' });
      }
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>('/api/users/:id/password', { config: writeRateLimit() }, async (req, reply) => {  // #370 throttle
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const id = parseUserId(req.params.id, reply);
    if (id === null) return;
    const targetUser = userRepo.findById(id);
    if (!targetUser) {
      return reply.code(404).send({ error: 'user_not_found' });
    }

    // 자기 자신의 비밀번호를 변경하는 경우: 현재 비밀번호 검증 필수
    // → 현재 비밀번호 없이 자기 계정 탈취 방지 (이슈 #31)
    const isSelf = req.user && Number(req.user.sub) === id;
    if (isSelf) {
      if (!parsed.data.currentPassword) {
        return reply.code(400).send({ error: 'current_password_required' });
      }
      const valid = await verifyPassword(targetUser.password_hash, parsed.data.currentPassword);
      if (!valid) {
        return reply.code(400).send({ error: 'invalid_current_password' });
      }
    }

    const hash = await hashPassword(parsed.data.password);
    userRepo.updatePassword(id, hash);

    // 이슈 #330/#331 — 비밀번호 변경 후 기존 발급 JWT 세션을 즉시 무효화.
    // bumpTokenVersion 으로 requireAuth 의 tv claim 비교가 다음 요청부터 실패하게 한다.
    userRepo.bumpTokenVersion(id);

    // 자기 자신 변경 케이스: 현재 요청을 보낸 세션도 즉시 끊기지 않도록 새 토큰을 재발급.
    // 다른 기기/탭에 남아있던 세션은 tv 불일치로 자동 차단되지만, 본인이 방금 비밀번호를
    // 바꾼 이 브라우저는 UX 상 즉시 로그아웃되지 않아야 자연스럽다.
    if (isSelf) {
      const updated = userRepo.findById(id)!;
      const newToken = signSessionToken({
        sub: String(updated.id),
        username: updated.username,
        tv: updated.token_version,
      });
      reply.setCookie(SESSION_COOKIE_NAME, newToken, buildSessionCookieOptions());
    }
    return { ok: true };
  });

  // 비활성화된 사용자를 재활성화 — disabled_at 을 NULL 로 초기화
  app.put<{ Params: { id: string } }>('/api/users/:id/enable', { config: writeRateLimit() }, async (req, reply) => {  // #370 throttle
    const id = parseUserId(req.params.id, reply);
    if (id === null) return;
    const user = userRepo.findById(id);
    if (!user) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    if (!user.disabled_at) {
      // 이미 활성 상태인 사용자에게 재활성화를 시도하면 멱등성 보장을 위해 200 반환
      return { ok: true };
    }
    userRepo.enable(id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', { config: writeRateLimit() }, async (req, reply) => {  // #370 throttle
    const id = parseUserId(req.params.id, reply);
    if (id === null) return;
    // 자기 자신을 비활성화하면 즉시 시스템 락아웃 위험 → 막는다.
    if (req.user && Number(req.user.sub) === id) {
      return reply.code(400).send({ error: 'cannot_disable_self' });
    }
    const target = userRepo.findById(id);
    if (!target) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    if (target.disabled_at) {
      // 이미 비활성 상태인 사용자에게 재호출 시 멱등성 보장 — DB write 생략하여
      // 최초 disabled_at(audit 가치) 보존 (#194). enable 핸들러와 대칭.
      return { ok: true };
    }
    userRepo.disable(id);
    // 이슈 #330 — 비활성화된 사용자의 기존 JWT 세션도 즉시 무효화한다.
    userRepo.bumpTokenVersion(id);
    return { ok: true };
  });
};
