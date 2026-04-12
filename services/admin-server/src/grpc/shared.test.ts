/// shared.ts 유닛 테스트 — call() 함수 및 loadClient() 기본 동작 검증
import { describe, it, expect, vi, beforeEach } from 'vitest';

// @grpc/proto-loader 와 @grpc/grpc-js 모킹 — 실제 proto 파일 없이 테스트
vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn(() => ({ fakePackage: true })),
}));

// loadPackageDefinition이 반환할 서비스 생성자
class FakeService {}
vi.mock('@grpc/grpc-js', () => ({
  loadPackageDefinition: vi.fn(() => ({
    cdn: { storage: { StorageService: FakeService } },
  })),
  credentials: {
    createInsecure: vi.fn(() => ({})),
  },
}));

import { call, loadClient, PROTO_BASE } from './shared.js';

describe('PROTO_BASE', () => {
  it('문자열 경로를 반환한다', () => {
    expect(typeof PROTO_BASE).toBe('string');
    expect(PROTO_BASE.length).toBeGreaterThan(0);
  });
});

describe('call', () => {
  it('성공 응답 시 resolve한다', async () => {
    const fakeClient = {
      someMethod: vi.fn(
        (_req: unknown, _opts: unknown, cb: (err: null, res: { ok: boolean }) => void) =>
          cb(null, { ok: true }),
      ),
    };
    const result = await call<{ ok: boolean }>(fakeClient as never, 'someMethod', { input: 1 });
    expect(result).toEqual({ ok: true });
    expect(fakeClient.someMethod).toHaveBeenCalledOnce();
  });

  it('gRPC 에러 시 reject한다', async () => {
    const grpcErr = Object.assign(new Error('연결 실패'), { code: 14 });
    const fakeClient = {
      failMethod: vi.fn(
        (_req: unknown, _opts: unknown, cb: (err: Error, res: null) => void) =>
          cb(grpcErr, null),
      ),
    };
    await expect(
      call(fakeClient as never, 'failMethod', {}),
    ).rejects.toThrow('연결 실패');
  });

  it('커스텀 타임아웃을 deadline으로 설정한다', async () => {
    const before = Date.now();
    const fakeClient = {
      myMethod: vi.fn(
        (_req: unknown, opts: { deadline: Date }, cb: (err: null, res: object) => void) => {
          expect(opts.deadline.getTime()).toBeGreaterThan(before + 999);
          cb(null, {});
        },
      ),
    };
    await call(fakeClient as never, 'myMethod', {}, 1000);
  });
});

describe('loadClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proto 파일에서 서비스 생성자를 반환한다', () => {
    const Ctor = loadClient('storage.proto', 'cdn.storage.StorageService');
    expect(typeof Ctor).toBe('function');
  });
});
