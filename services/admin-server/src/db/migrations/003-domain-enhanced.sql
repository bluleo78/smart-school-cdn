-- 도메인 테이블 확장: enabled, description, updated_at 컬럼 추가
-- SQLite는 ALTER TABLE ADD COLUMN만 지원하므로 컬럼별로 실행
ALTER TABLE domains ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE domains ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE domains ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'));

-- 도메인별 시계열 통계 테이블
-- (host, timestamp) 복합 PK로 버킷 단위 집계 저장
CREATE TABLE IF NOT EXISTS domain_stats (
  host TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  cache_misses INTEGER NOT NULL DEFAULT 0,
  bandwidth INTEGER NOT NULL DEFAULT 0,
  avg_response_time INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (host, timestamp),
  FOREIGN KEY (host) REFERENCES domains(host) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_domain_stats_ts ON domain_stats(timestamp);
