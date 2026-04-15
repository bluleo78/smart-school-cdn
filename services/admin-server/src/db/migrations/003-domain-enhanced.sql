-- 도메인 테이블 확장: enabled, description, updated_at 컬럼 추가
-- SQLite는 ALTER TABLE ADD COLUMN만 지원하므로 컬럼별로 실행
ALTER TABLE domains ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE domains ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE domains ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'));
