/// storage_client.ts 유닛 테스트 — createStorageClient 팩토리 및 메서드 검증
import { describe, it, expect, vi, beforeEach } from 'vitest';

// shared.js 모킹 — 실제 gRPC 연결 없이 메서드 호출 검증
const { mockCall, mockLoadClient } = vi.hoisted(() => ({
  mockCall: vi.fn(),
  mockLoadClient: vi.fn(),
}));

vi.mock('./shared.js', () => ({
  call: mockCall,
  loadClient: mockLoadClient,
  PROTO_BASE: '/mock',
}));

vi.mock('@grpc/grpc-js', () => ({
  credentials: { createInsecure: vi.fn(() => ({})) },
}));

import { createStorageClient } from './storage_client.js';

describe('createStorageClient', () => {
  let mockClientInstance: object;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance = {};
    // loadClient가 반환하는 생성자 — new 호출 시 mockClientInstance를 돌려줌
    mockLoadClient.mockReturnValue(function MockCtor() {
      return mockClientInstance;
    });
    mockCall.mockResolvedValue({});
  });

  it('stats()가 Stats gRPC 메서드를 호출한다', async () => {
    const client = createStorageClient('localhost:50051');
    await client.stats();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Stats', {});
  });

  it('popular(limit)이 Popular gRPC 메서드를 호출한다', async () => {
    const client = createStorageClient('localhost:50051');
    await client.popular(20);
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Popular', { limit: 20 });
  });

  it('purgeUrl(url)이 Purge gRPC 메서드를 올바른 payload로 호출한다', async () => {
    const client = createStorageClient('localhost:50051');
    await client.purgeUrl('https://example.com/img.jpg');
    expect(mockCall).toHaveBeenCalledWith(
      mockClientInstance, 'Purge', { url: 'https://example.com/img.jpg' },
    );
  });

  it('purgeDomain(domain)이 Purge gRPC 메서드를 호출한다', async () => {
    const client = createStorageClient('localhost:50051');
    await client.purgeDomain('example.com');
    expect(mockCall).toHaveBeenCalledWith(
      mockClientInstance, 'Purge', { domain: 'example.com' },
    );
  });

  it('purgeAll()이 Purge gRPC 메서드를 all: true로 호출한다', async () => {
    const client = createStorageClient('localhost:50051');
    await client.purgeAll();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Purge', { all: true });
  });

  it('health()가 Health gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ online: true, latency_ms: 3 });
    const client = createStorageClient('localhost:50051');
    const result = await client.health();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Health', {});
    expect(result).toEqual({ online: true, latency_ms: 3 });
  });
});
