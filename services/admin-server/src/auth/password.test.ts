import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('hash 한 값으로 verify 가 true', async () => {
    const h = await hashPassword('secret12');
    expect(await verifyPassword(h, 'secret12')).toBe(true);
  });

  it('잘못된 값으로 verify 는 false', async () => {
    const h = await hashPassword('secret12');
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('동일 입력이라도 해시는 다름(salt)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
  });

  it('결과는 argon2id encoded string', async () => {
    const h = await hashPassword('x');
    expect(h).toMatch(/^\$argon2id\$/);
  });
});
