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
import type {
  StatsResponse,
  RecentQueriesResponse,
  RecordsResponse,
} from './dns_client.js';

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

  it('getStats()가 GetStats gRPC 메서드를 빈 페이로드로 호출한다', async () => {
    // uint64 필드는 proto-loader longs:String 설정으로 문자열로 전달됨
    const stats: StatsResponse = {
      total_queries: '120',
      matched: '80',
      nxdomain: '10',
      forwarded: '30',
      uptime_secs: '3600',
      top_domains: [
        { qname: 'textbook.example.com', count: 50 },
        { qname: 'cdn.example.com', count: 30 },
      ],
    };
    mockCall.mockResolvedValue(stats);
    const client = createDnsClient('localhost:50053');
    const result = await client.getStats();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetStats', {});
    expect(result).toEqual(stats);
  });

  it('getRecentQueries(50)가 GetRecentQueries에 limit 50을 전달한다', async () => {
    const resp: RecentQueriesResponse = {
      entries: [
        {
          ts_unix_ms: '1713456789000',
          client_ip: '10.0.0.1',
          qname: 'textbook.example.com',
          qtype: 'A',
          result: 'matched',
          latency_us: 1200,
        },
      ],
    };
    mockCall.mockResolvedValue(resp);
    const client = createDnsClient('localhost:50053');
    const result = await client.getRecentQueries(50);
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetRecentQueries', { limit: 50 });
    expect(result).toEqual(resp);
  });

  it('getRecentQueries() 기본값은 limit 100으로 호출된다', async () => {
    mockCall.mockResolvedValue({ entries: [] } as RecentQueriesResponse);
    const client = createDnsClient('localhost:50053');
    await client.getRecentQueries();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetRecentQueries', { limit: 100 });
  });

  it('getRecords()가 GetRecords gRPC 메서드를 빈 페이로드로 호출한다', async () => {
    const resp: RecordsResponse = {
      records: [
        { host: 'textbook.example.com', target: '10.0.0.10', rtype: 'A', source: 'auto' },
      ],
    };
    mockCall.mockResolvedValue(resp);
    const client = createDnsClient('localhost:50053');
    const result = await client.getRecords();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetRecords', {});
    expect(result).toEqual(resp);
  });
});
