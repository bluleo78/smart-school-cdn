import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * 패스워드 해시 — argon2id (OWASP 2023 기본값). 결과는 전체 encoded string.
 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: Algorithm.Argon2id });
}

/**
 * 저장된 해시와 평문을 비교. 값 불일치 또는 해시 파싱 실패 시 false.
 */
export async function verifyPassword(encoded: string, plain: string): Promise<boolean> {
  try {
    return await verify(encoded, plain);
  } catch {
    return false;
  }
}
