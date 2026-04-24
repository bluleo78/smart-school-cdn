import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signSessionToken, verifySessionToken } from './jwt.js';

describe('jwt', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-'.repeat(4); // 32+ bytes
  });

  it('sign 후 verify 하면 payload 복원', () => {
    const token = signSessionToken({ sub: '1', username: 'a@b.c' });
    const claims = verifySessionToken(token);
    expect(claims?.sub).toBe('1');
    expect(claims?.username).toBe('a@b.c');
    expect(claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('서명 조작된 토큰은 null', () => {
    const token = signSessionToken({ sub: '1', username: 'a@b.c' });
    const bad = token.slice(0, -2) + 'xx';
    expect(verifySessionToken(bad)).toBeNull();
  });

  it('만료된 토큰은 null', () => {
    vi.useFakeTimers();
    const token = signSessionToken({ sub: '1', username: 'a@b.c' });
    vi.setSystemTime(Date.now() + 3601 * 1000);
    expect(verifySessionToken(token)).toBeNull();
    vi.useRealTimers();
  });

  it('JWT_SECRET 미설정 시 sign 호출하면 throw', () => {
    delete process.env.JWT_SECRET;
    expect(() => signSessionToken({ sub: '1', username: 'a@b.c' })).toThrow();
  });
});
