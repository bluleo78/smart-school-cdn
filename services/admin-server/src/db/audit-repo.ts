/// 이슈 #351 — 관리자 활동 감사 로그.
///
/// 무엇을: 도메인/사용자/캐시 상태 변경 액션을 행 단위로 기록.
///        actor(누가) / action(무엇을) / target(어디에) / before/after(어떻게) / created_at.
/// 왜: 운영 사고 발생 시 "누가, 언제, 무엇을 변경했는지" 추적. 다중 IT 담당자 운영 환경에서
///    누구의 액션이 사고 원인인지 즉시 식별 가능. 학교 보안 점검 시 컴플라이언스 대응.
import type Database from 'better-sqlite3';

/** PK + 필터 인덱스. INTEGER unix-sec (#377 규약 준수). */
export const AUDIT_LOGS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id   INTEGER,
    actor_ip        TEXT,
    action          TEXT    NOT NULL,
    target_type     TEXT    NOT NULL,
    target_id       TEXT,
    before_json     TEXT,
    after_json      TEXT,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_logs(actor_user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_target    ON audit_logs(target_type, target_id);
`;

export interface AuditLogInput {
  actor_user_id?: number | null;
  actor_ip?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditLogRow {
  id: number;
  actor_user_id: number | null;
  actor_ip: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: number;
}

export interface AuditQuery {
  action?: string;
  actor_user_id?: number;
  target_type?: string;
  target_id?: string;
  /** unix sec inclusive */
  from?: number;
  /** unix sec inclusive */
  to?: number;
  limit?: number;
  offset?: number;
}

export interface AuditListResult {
  rows: AuditLogRow[];
  total: number;
}

export class AuditRepository {
  constructor(private readonly db: Database.Database) {}

  /** 단일 감사 행 기록. before/after 는 JSON.stringify. 실패는 swallow (운영 기능을 막지 않게). */
  insert(input: AuditLogInput): void {
    try {
      this.db.prepare(
        `INSERT INTO audit_logs
           (actor_user_id, actor_ip, action, target_type, target_id, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.actor_user_id ?? null,
        input.actor_ip ?? null,
        input.action,
        input.target_type,
        input.target_id ?? null,
        input.before !== undefined ? JSON.stringify(input.before) : null,
        input.after  !== undefined ? JSON.stringify(input.after)  : null,
        Math.floor(Date.now() / 1000),
      );
    } catch {
      // 감사 로그 실패가 본 액션을 막지 않도록 swallow. pino 로그는 caller 가 별도 처리.
    }
  }

  /** 필터/페이지 조회. rows + total 반환 (admin-web 페이지네이션). */
  query(q: AuditQuery = {}): AuditListResult {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (q.action) { where.push('action = @action'); params.action = q.action; }
    if (q.actor_user_id !== undefined) { where.push('actor_user_id = @actor'); params.actor = q.actor_user_id; }
    if (q.target_type) { where.push('target_type = @ttype'); params.ttype = q.target_type; }
    if (q.target_id) { where.push('target_id = @tid'); params.tid = q.target_id; }
    if (q.from !== undefined) { where.push('created_at >= @from'); params.from = q.from; }
    if (q.to   !== undefined) { where.push('created_at <= @to');   params.to   = q.to; }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db
      .prepare(`SELECT COUNT(*) AS c FROM audit_logs ${whereClause}`)
      .get(params) as { c: number }).c;

    const limit  = Number.isFinite(q.limit)  && (q.limit as number)  > 0 ? Math.min(1000, Math.floor(q.limit!))  : 50;
    const offset = Number.isFinite(q.offset) && (q.offset as number) >= 0 ? Math.floor(q.offset!) : 0;

    const rows = this.db
      .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`)
      .all(params) as AuditLogRow[];
    return { rows, total };
  }
}
