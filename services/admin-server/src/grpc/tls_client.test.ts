/// tls_client.ts 유닛 테스트 — createTlsClient 팩토리 및 메서드 검증
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

import { createTlsClient } from './tls_client.js';

describe('createTlsClient', () => {
  let mockClientInstance: object;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance = {};
    mockLoadClient.mockReturnValue(function MockCtor() {
      return mockClientInstance;
    });
    mockCall.mockResolvedValue({});
  });

  it('getCACert()가 GetCACert gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ cert_pem: '-----BEGIN CERTIFICATE-----\n...' });
    const client = createTlsClient('localhost:50052');
    const result = await client.getCACert();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'GetCACert', {});
    expect(result).toHaveProperty('cert_pem');
  });

  it('listCertificates()가 ListCertificates gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({
      certs: [{ domain: 'example.com', issued_at: '2026-01-01', expires_at: '2027-01-01', status: 'active' }],
    });
    const client = createTlsClient('localhost:50052');
    const result = await client.listCertificates();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'ListCertificates', {});
    expect(result).toHaveProperty('certs');
  });

  it('syncDomains(domains)가 SyncDomains gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ success: true });
    const client = createTlsClient('localhost:50052');
    const domains = [{ host: 'cdn.example.com', origin: 'https://origin.example.com' }];
    await client.syncDomains(domains);
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'SyncDomains', { domains });
  });

  it('health()가 Health gRPC 메서드를 호출한다', async () => {
    mockCall.mockResolvedValue({ online: true, latency_ms: 5 });
    const client = createTlsClient('localhost:50052');
    const result = await client.health();
    expect(mockCall).toHaveBeenCalledWith(mockClientInstance, 'Health', {});
    expect(result).toEqual({ online: true, latency_ms: 5 });
  });
});
