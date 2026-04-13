/// optimizer_client.ts 유닛 테스트
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

import { createOptimizerClient } from './optimizer_client.js';

describe('createOptimizerClient', () => {
  let mockClientInstance: object;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance = {};
    mockLoadClient.mockReturnValue(function MockCtor() {
      return mockClientInstance;
    });
    mockCall.mockResolvedValue({});
  });

  it('getProfiles()가 GetProfiles gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ profiles: [] });
    const client = createOptimizerClient('localhost:50054');
    const result = await client.getProfiles();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetProfiles', {});
    expect(result).toHaveProperty('profiles');
  });

  it('setProfile()이 SetProfile gRPC 메서드를 호출한다', async () => {
    const client = createOptimizerClient('localhost:50054');
    const profile = { domain: 'example.com', quality: 85, max_width: 0, enabled: true };
    await client.setProfile(profile);
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'SetProfile', { profile });
  });

  it('getStats()가 GetStats gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ stats: [] });
    const client = createOptimizerClient('localhost:50054');
    const result = await client.getStats();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetStats', {});
    expect(result).toHaveProperty('stats');
  });

  it('health()가 Health gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ online: true, latency_ms: 2 });
    const client = createOptimizerClient('localhost:50054');
    const result = await client.health();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Health', {});
    expect(result).toEqual({ online: true, latency_ms: 2 });
  });
});
