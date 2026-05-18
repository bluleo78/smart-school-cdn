import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import { usersRoutes } from './users.js';
import { UserRepository, USER_SCHEMA } from '../db/user-repo.js';
import { createRequireAuth } from '../auth/require-auth.js';
import { SESSION_COOKIE_NAME, signSessionToken } from '../auth/jwt.js';
import { hashPassword } from '../auth/password.js';

async function buildApp() {
  process.env.JWT_SECRET = 'test-secret-'.repeat(4);
  const db = new Database(':memory:');
  db.exec(USER_SCHEMA);
  const userRepo = new UserRepository(db);
  const u = userRepo.create('admin@school.local', await hashPassword('password1'));
  const token = signSessionToken({ sub: String(u.id), username: u.username, tv: u.token_version });

  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', createRequireAuth(userRepo));
  await app.register(usersRoutes, { userRepo });
  return { app, userRepo, adminId: u.id, cookies: { [SESSION_COOKIE_NAME]: token } };
}

describe('usersRoutes', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => {
    ctx = await buildApp();
  });

  it('GET /api/users — 인증 없으면 401', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/users' });
    expect(r.statusCode).toBe(401);
  });

  it('GET /api/users — password_hash 제외 반환', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: ctx.cookies });
    expect(r.statusCode).toBe(200);
    const users = r.json();
    expect(users[0].username).toBe('admin@school.local');
    expect('password_hash' in users[0]).toBe(false);
  });

  // 이슈 #342 — users 응답 타임스탬프는 INTEGER unix seconds (domains 와 동일 표준)
  it('GET /api/users — 타임스탬프는 INTEGER unix seconds 로 직렬화 (#342)', async () => {
    // last_login_at 도 검증하기 위해 사전 갱신
    ctx.userRepo.updateLastLogin(1);
    const r = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: ctx.cookies });
    expect(r.statusCode).toBe(200);
    const users = r.json();
    const u = users[0];
    expect(typeof u.created_at).toBe('number');
    expect(typeof u.updated_at).toBe('number');
    expect(typeof u.last_login_at).toBe('number');
    // 합리적 범위: 2020-01-01 ~ 2100-01-01 (TEXT 잔존 시 NaN/0 방지 가드)
    expect(u.created_at).toBeGreaterThan(1577836800);
    expect(u.created_at).toBeLessThan(4102444800);
    // disabled_at 은 null 가능 (admin 은 활성 상태)
    expect(u.disabled_at).toBeNull();
  });

  it('GET /api/users — 기본 정렬은 created_at DESC, 최신 사용자가 첫 번째 (#344)', async () => {
    // 신규 사용자가 등록되면 새 row 의 created_at 이 admin 의 created_at 보다 늦어진다.
    // 도메인·이벤트와 동일하게 최신 우선 정책을 따라 신규 사용자가 첫 번째에 노출되어야 한다.
    await new Promise((r) => setTimeout(r, 5));
    ctx.userRepo.create('latest@school.local', 'hash');
    const r = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: ctx.cookies });
    expect(r.statusCode).toBe(200);
    const users = r.json();
    expect(users[0].username).toBe('latest@school.local');
  });

  it('GET /api/users?sort=id&order=asc — 명시적 정렬이 기본값보다 우선 (#344)', async () => {
    await new Promise((r) => setTimeout(r, 5));
    ctx.userRepo.create('latest@school.local', 'hash');
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/users?sort=id&order=asc',
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    const users = r.json();
    // id ASC 는 admin(id=1)이 첫 번째
    expect(users[0].username).toBe('admin@school.local');
  });

  it('GET /api/users?sort=invalid — 화이트리스트 외 값은 400 (#344)', async () => {
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/users?sort=DROP_TABLE',
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_input');
  });

  it('GET /api/users?order=sideways — 잘못된 order 값은 400 (#344)', async () => {
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/users?order=sideways',
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_input');
  });

  it('POST /api/users — 정상 생성', async () => {
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/users',
      cookies: ctx.cookies,
      payload: { username: 'new@school.local', password: 'password2' },
    });
    expect(r.statusCode).toBe(201);
    expect(ctx.userRepo.count()).toBe(2);
  });

  it('POST /api/users — 중복 username 409', async () => {
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/users',
      cookies: ctx.cookies,
      payload: { username: 'admin@school.local', password: 'password2' },
    });
    expect(r.statusCode).toBe(409);
  });

  // 이슈 #190 — username 대소문자만 다른 입력은 동일 계정으로 취급되어 중복 차단
  it('POST /api/users — 대소문자만 다른 username 은 중복으로 409', async () => {
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/users',
      cookies: ctx.cookies,
      payload: { username: 'ADMIN@school.local', password: 'password2' },
    });
    expect(r.statusCode).toBe(409);
  });

  // 이슈 #190 — 신규 생성 시 username 은 lower-case 로 정규화되어 저장된다
  it('POST /api/users — 대문자 입력은 lower-case 로 저장된다', async () => {
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/users',
      cookies: ctx.cookies,
      payload: { username: 'NewUser@SCHOOL.local', password: 'password2' },
    });
    expect(r.statusCode).toBe(201);
    // 저장 시 lower-case 로 정규화됐는지는 row 의 username 필드로 직접 확인.
    // 이슈 #340 이후 findByUsername 은 COLLATE NOCASE 라 대소문자 관계없이 매칭되므로
    // 조회 결과 null 비교만으로는 정규화 여부를 판정할 수 없다.
    const found = ctx.userRepo.findByUsername('newuser@school.local');
    expect(found).not.toBeNull();
    expect(found?.username).toBe('newuser@school.local');
  });

  // 이슈 #207 — 동시 요청 race 로 사전 findByUsername 검사를 두 요청이 모두 통과한
  // 뒤 INSERT 단계에서 SQLite UNIQUE 위반이 던져지는 시나리오.
  // findByUsername 을 일시적으로 null 반환으로 stub 하면 사전 차단이 우회되어 라우트가
  // 직접 INSERT 까지 가서 UNIQUE 위반을 받는다 (실제 동시성을 결정적으로 재현).
  // 기대: raw SQLite 메시지가 500 internal_error 로 노출되지 않고 409 username_already_exists.
  it('POST /api/users — INSERT 단계 UNIQUE 위반은 500 이 아닌 409 로 매핑 (#207)', async () => {
    const orig = ctx.userRepo.findByUsername.bind(ctx.userRepo);
    ctx.userRepo.findByUsername = (() => null) as typeof orig;
    try {
      const r = await ctx.app.inject({
        method: 'POST', url: '/api/users',
        cookies: ctx.cookies,
        payload: { username: 'admin@school.local', password: 'password2' },
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('username_already_exists');
      // raw SQLite 에러 메시지 누출 없는지 확인
      expect(JSON.stringify(r.json())).not.toMatch(/UNIQUE constraint/i);
    } finally {
      ctx.userRepo.findByUsername = orig;
    }
  });

  // 이슈 #31 — 자기 자신 비밀번호 변경 시 currentPassword 포함 성공
  it('PUT /api/users/:id/password — 자기 자신: currentPassword 포함 성공', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${ctx.adminId}/password`,
      cookies: ctx.cookies,
      payload: { password: 'newpass123', currentPassword: 'password1' },
    });
    expect(r.statusCode).toBe(200);
    const { verifyPassword } = await import('../auth/password.js');
    const u = ctx.userRepo.findById(ctx.adminId)!;
    expect(await verifyPassword(u.password_hash, 'newpass123')).toBe(true);
  });

  // 이슈 #31 — 자기 자신 비밀번호 변경 시 currentPassword 누락 → 400
  it('PUT /api/users/:id/password — 자기 자신: currentPassword 누락 시 400', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${ctx.adminId}/password`,
      cookies: ctx.cookies,
      payload: { password: 'newpass123' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('current_password_required');
  });

  // 이슈 #31 — 자기 자신 비밀번호 변경 시 currentPassword 틀림 → 400
  it('PUT /api/users/:id/password — 자기 자신: currentPassword 틀림 시 400', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${ctx.adminId}/password`,
      cookies: ctx.cookies,
      payload: { password: 'newpass123', currentPassword: 'wrongpassword' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_current_password');
  });

  // 이슈 #31 — 다른 사용자 비밀번호 변경 시 currentPassword 없이도 성공 (관리자 권한)
  it('PUT /api/users/:id/password — 다른 사용자: currentPassword 없이 성공', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('otherpass1'));
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${other.id}/password`,
      cookies: ctx.cookies,
      payload: { password: 'adminreset123' },
    });
    expect(r.statusCode).toBe(200);
    const { verifyPassword } = await import('../auth/password.js');
    const u = ctx.userRepo.findById(other.id)!;
    expect(await verifyPassword(u.password_hash, 'adminreset123')).toBe(true);
  });

  // 이슈 #331 — 다른 사용자 비밀번호 재설정 시 대상 사용자의 token_version 이 +1 되어
  // 기존 발급 JWT 세션이 다음 요청에서 즉시 무효화된다.
  it('PUT /api/users/:id/password — 다른 사용자: 대상의 token_version bump (#331)', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    expect(other.token_version).toBe(0);
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${other.id}/password`,
      cookies: ctx.cookies,
      payload: { password: 'adminreset123' },
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.token_version).toBe(1);
  });

  // 이슈 #331 — 자기 자신 비밀번호 변경: token_version 이 bump 되고 동시에
  // 새 토큰을 쿠키로 재발급하여 진행 중인 세션이 끊기지 않도록 한다.
  it('PUT /api/users/:id/password — 자기 자신: token_version bump + 새 쿠키 재발급 (#331)', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${ctx.adminId}/password`,
      cookies: ctx.cookies,
      payload: { password: 'newpass123', currentPassword: 'password1' },
    });
    expect(r.statusCode).toBe(200);
    const updated = ctx.userRepo.findById(ctx.adminId)!;
    expect(updated.token_version).toBe(1);
    // Set-Cookie 로 새 session 토큰이 동봉되어야 한다 (기존 토큰은 tv=0 이라 다음 요청에서 무효)
    const setCookie = String(r.headers['set-cookie'] ?? '');
    expect(setCookie).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=`));
    expect(setCookie).not.toMatch(/Max-Age=0/);
  });

  // 이슈 #106 회귀 방지 — PUT /api/users/:id/enable 엔드포인트 누락
  it('PUT /api/users/:id/enable — 비활성 사용자 재활성화', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    ctx.userRepo.disable(other.id);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).not.toBeNull();

    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${other.id}/enable`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).toBeNull();
  });

  // 이슈 #106 — 이미 활성 사용자에게 enable 호출 시 멱등성 보장
  it('PUT /api/users/:id/enable — 이미 활성 사용자에게 호출해도 200', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    const r = await ctx.app.inject({
      method: 'PUT', url: `/api/users/${other.id}/enable`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).toBeNull();
  });

  // 이슈 #106 — 존재하지 않는 사용자에게 enable 호출 시 404
  it('PUT /api/users/:id/enable — 존재하지 않는 사용자 404', async () => {
    const r = await ctx.app.inject({
      method: 'PUT', url: '/api/users/9999/enable',
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(404);
  });

  it('DELETE /api/users/:id — 다른 계정 비활성', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    const r = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${other.id}`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).not.toBeNull();
  });

  // 이슈 #330 — 비활성화 시 token_version 도 +1 되어 기존 JWT 가 다음 요청에서 무효화된다.
  it('DELETE /api/users/:id — 비활성화 시 대상의 token_version bump (#330)', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    expect(other.token_version).toBe(0);
    const r = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${other.id}`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.token_version).toBe(1);
  });

  // 이슈 #194 — 이미 비활성 사용자에게 DELETE 재호출 시 disabled_at 변경 없음 (멱등)
  it('DELETE /api/users/:id — 이미 비활성 사용자 재호출 시 disabled_at 보존', async () => {
    const other = ctx.userRepo.create('other@x.y', await hashPassword('p'));
    const r1 = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${other.id}`,
      cookies: ctx.cookies,
    });
    expect(r1.statusCode).toBe(200);
    const firstDisabledAt = ctx.userRepo.findById(other.id)?.disabled_at;
    expect(firstDisabledAt).not.toBeNull();

    // 시간이 흘러도 덮어쓰지 않도록 강제 — 짧은 딜레이 후 재호출
    await new Promise((res) => setTimeout(res, 10));
    const r2 = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${other.id}`,
      cookies: ctx.cookies,
    });
    expect(r2.statusCode).toBe(200);
    expect(ctx.userRepo.findById(other.id)?.disabled_at).toBe(firstDisabledAt);
  });

  it('DELETE /api/users/:id — 자기 자신은 400', async () => {
    const r = await ctx.app.inject({
      method: 'DELETE', url: `/api/users/${ctx.adminId}`,
      cookies: ctx.cookies,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('cannot_disable_self');
  });

  // #325 — :id 정수 검증 가드. 비숫자/오버플로우/0/음수가 NaN 또는 부정확한
  // 정수로 변환되어 user_not_found(404)에 가려지던 문제를 사전 400 으로 거부.
  describe(':id 정수 검증 (#325)', () => {
    const invalidIds = [
      'abc',                           // 비숫자
      '99999999999999999999',          // 안전 정수 범위 초과
      '0',                             // 0 — userRepo id 는 1 이상
      '-1',                            // 음수 (정규식에서 거부)
      '1.5',                           // 소수
      '1e10',                          // 지수 표기
      '',                              // 빈 문자열은 라우팅 자체 실패라 제외
    ].filter((v) => v !== '');

    for (const bad of invalidIds) {
      it(`DELETE /api/users/${bad} → 400 invalid_input`, async () => {
        const r = await ctx.app.inject({
          method: 'DELETE', url: `/api/users/${bad}`,
          cookies: ctx.cookies,
        });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toBe('invalid_input');
      });
      it(`PUT /api/users/${bad}/enable → 400 invalid_input`, async () => {
        const r = await ctx.app.inject({
          method: 'PUT', url: `/api/users/${bad}/enable`,
          cookies: ctx.cookies,
        });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toBe('invalid_input');
      });
      it(`PUT /api/users/${bad}/password → 400 invalid_input`, async () => {
        const r = await ctx.app.inject({
          method: 'PUT', url: `/api/users/${bad}/password`,
          cookies: ctx.cookies,
          payload: { password: 'newpassword1' },
        });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toBe('invalid_input');
      });
    }
  });
});
