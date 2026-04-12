/// dns_client.ts 유닛 테스트 — createDnsClient 팩토리 및 메서드 검증
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { createDnsClient } from './dns_client.js';

describe('createDnsClient', () => {
  let mockClientInstance: object;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance = {};
    mockLoadClient.mockReturnValue(function MockCtor() {
      return mockClientInstance;
    });
    mockCall.mockResolvedValue({});
  });

  it('syncDomains(domains)가 SyncDomains gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ success: true });
    const client = createDnsClient('localhost:50053');
    const domains = [{ host: '*.textbook.com', origin: 'https://textbook.com' }];
    await client.syncDomains(domains);
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'SyncDomains', { domains });
  });

  it('syncDomains 빈 목록도 호출한다', async () => {
    const client = createDnsClient('localhost:50053');
    await client.syncDomains([]);
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'SyncDomains', { domains: [] });
  });

  it('health()가 Health gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ online: true, latency_ms: 2 });
    const client = createDnsClient('localhost:50053');
    const result = await client.health();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Health', {});
    expect(result).toEqual({ online: true, latency_ms: 2 });
  });
});
