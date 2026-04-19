-- Phase 13/14/15 공용 — 최적화 이벤트 레코드 테이블
-- Media Range 캐싱·이미지 최적화·텍스트 압축의 개별 요청 처리 결과를 기록한다.
-- event_type 컬럼으로 세 Phase를 구분하며, decision 컬럼으로 처리 결과를 구분한다.
CREATE TABLE IF NOT EXISTS optimization_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,        -- ISO8601 UTC
  event_type   TEXT NOT NULL,        -- 'media_cache' | 'image_optimize' | 'text_compress'
  host         TEXT NOT NULL,
  url_hash     TEXT NOT NULL,        -- SHA-256 앞 16자 (인덱스 정렬 효율용)
  url          TEXT NOT NULL,
  decision     TEXT NOT NULL,        -- 'served_200','served_206','stored_new','bypass_*','rejected_size', ...
  orig_size    INTEGER,              -- 원본 바이트 (nullable)
  out_size     INTEGER,              -- 결과 바이트 (nullable)
  range_header TEXT,                 -- 클라이언트가 보낸 Range 헤더 원문 (nullable)
  content_type TEXT,                 -- origin 응답 Content-Type (nullable)
  elapsed_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opt_events_host_ts       ON optimization_events(host, ts);
CREATE INDEX IF NOT EXISTS idx_opt_events_type_decision ON optimization_events(event_type, decision);
CREATE INDEX IF NOT EXISTS idx_opt_events_ts            ON optimization_events(ts);
