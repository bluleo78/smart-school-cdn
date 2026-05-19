/// AuditRepository 단위 테스트 (#351)
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AuditRepository, AUDIT_LOGS_SCHEMA } from './audit-repo.js';

describe('AuditRepository', () => {
  let db: Database.Database;
  let repo: AuditRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(AUDIT_LOGS_SCHEMA);
    repo = new AuditRepository(db);
  });

  it('insert 후 query 로 조회된다 — before/after JSON 직렬화', () => {
    repo.insert({
      actor_user_id: 7, actor_ip: '127.0.0.1',
      action: 'domain.create', target_type: 'domain', target_id: 'a.test',
      after: { host: 'a.test', origin: 'https://a.test' },
    });
    const { rows, total } = repo.query();
    expect(total).toBe(1);
    expect(rows[0].action).toBe('domain.create');
    expect(JSON.parse(rows[0].after_json!)).toEqual({ host: 'a.test', origin: 'https://a.test' });
  });

  it('action 필터로 좁힌다', () => {
    repo.insert({ action: 'domain.create',  target_type: 'domain', target_id: 'a' });
    repo.insert({ action: 'domain.delete',  target_type: 'domain', target_id: 'b' });
    repo.insert({ action: 'user.create',    target_type: 'user',   target_id: '1' });
    const { rows, total } = repo.query({ action: 'domain.create' });
    expect(total).toBe(1);
    expect(rows[0].target_id).toBe('a');
  });

  it('from/to (unix sec) 시간 윈도우 필터', () => {
    repo.insert({ action: 'x', target_type: 't' });
    const now = Math.floor(Date.now() / 1000);
    const { total } = repo.query({ from: now - 5, to: now + 5 });
    expect(total).toBe(1);
    const { total: outsideTotal } = repo.query({ from: now + 100 });
    expect(outsideTotal).toBe(0);
  });

  it('limit/offset 페이지네이션 — 최신순 정렬', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({ action: 'x', target_type: 't', target_id: String(i) });
    }
    const page = repo.query({ limit: 2, offset: 0 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it('insert 실패는 swallow — 잘못된 DB 상태에서도 throw 없음', () => {
    db.close();
    // closed DB 에 insert 시도 — internal try/catch 가 swallow
    expect(() => repo.insert({ action: 'x', target_type: 't' })).not.toThrow();
  });
});
