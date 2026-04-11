import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });

await app.register(cors);

/** 헬스체크 엔드포인트 */
app.get('/api/health', async () => {
  return { status: 'ok' };
});

const port = Number(process.env.PORT) || 4001;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Admin Server listening on port ${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
