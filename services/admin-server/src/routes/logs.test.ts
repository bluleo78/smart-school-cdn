/// /api/logs/:service SSE 엔드포인트 유닛 테스트
/// Docker API 응답을 모킹하여 SSE 헤더, 화이트리스트 검증, 로그 파싱을 테스트한다.
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import http from 'http';
import type { ClientRequest, IncomingMessage } from 'http';
import { PassThrough } from 'stream';
import { logRoutes } from './logs.js';

/** 테스트용 Fastify 앱 생성 */
async function createApp() {
  const app = Fastify({ logger: false });
  await app.register(logRoutes);
  return app;
}

/** http.request 스파이용 콜백 타입 */
type RequestCallback = (res: IncomingMessage) => void;

describe('GET /api/logs/:service', () => {
  afterEach(() => vi.restoreAllMocks());

  it('허용되지 않은 서비스명은 400을 반환한다', async () => {
    const app = await createApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/unknown-service',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: '허용되지 않은 서비스입니다.' });
  });

  it('허용된 서비스명 6개를 모두 수락한다', async () => {
    const services = ['proxy', 'storage', 'tls', 'dns', 'optimizer', 'admin'];
    const app = await createApp();

    for (const service of services) {
      const mockRes = new PassThrough() as unknown as IncomingMessage;
      (mockRes as unknown as Record<string, unknown>).statusCode = 200;
      vi.spyOn(http, 'request').mockImplementationOnce(
        ((_opts, cb?: RequestCallback): ClientRequest => {
          if (cb) cb(mockRes);
          (mockRes as unknown as PassThrough).end();
          const mockReq = new PassThrough() as unknown as ClientRequest;
          (mockReq as unknown as Record<string, unknown>).end = vi.fn();
          return mockReq;
        }) as typeof http.request
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/logs/${service}?follow=false&tail=10`,
      });
      expect(res.statusCode).not.toBe(400);
    }
  });

  it('follow=false일 때 Docker 로그를 파싱하여 JSON 배열을 반환한다', async () => {
    const app = await createApp();
    const mockRes = new PassThrough() as unknown as IncomingMessage;
    (mockRes as unknown as Record<string, unknown>).statusCode = 200;

    vi.spyOn(http, 'request').mockImplementationOnce(
      ((_opts, cb?: RequestCallback): ClientRequest => {
        if (cb) cb(mockRes);
        // Docker 멀티플렉스 형식: 8-byte 헤더 [stream_type(1), 0,0,0, size(4)] + payload
        const line1 = '2026-04-14T10:00:00.000Z INFO  cache HIT host=example.com\n';
        const hdr1 = Buffer.alloc(8);
        hdr1[0] = 1; // stdout
        hdr1.writeUInt32BE(line1.length, 4);
        (mockRes as unknown as PassThrough).write(Buffer.concat([hdr1, Buffer.from(line1)]));

        const line2 = '2026-04-14T10:00:01.000Z WARN  coalescer broadcast lagged\n';
        const hdr2 = Buffer.alloc(8);
        hdr2[0] = 1;
        hdr2.writeUInt32BE(line2.length, 4);
        (mockRes as unknown as PassThrough).write(Buffer.concat([hdr2, Buffer.from(line2)]));

        (mockRes as unknown as PassThrough).end();
        const mockReq = new PassThrough() as unknown as ClientRequest;
        (mockReq as unknown as Record<string, unknown>).end = vi.fn();
        return mockReq;
      }) as typeof http.request
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/logs/proxy?follow=false&tail=10',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ level: string; message: string; service: string }>;
    expect(body).toHaveLength(2);
    expect(body[0].level).toBe('INFO');
    expect(body[0].message).toContain('cache HIT');
    expect(body[0].service).toBe('proxy');
    expect(body[1].level).toBe('WARN');
  });
});
