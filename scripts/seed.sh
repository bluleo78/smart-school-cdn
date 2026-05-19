#!/usr/bin/env bash
# 탐색적 테스트용 시드 스크립트
# 사용: bash .claude/scripts/seed.sh [full|empty]
#   full  — 다양한 도메인 + 통계·DNS·최적화 데이터 (스파크라인/차트 검증용)
#   empty — 도메인 2건만, 통계 없음 (빈 상태 UI 검증용, 기본값)

set -e

DB="services/admin-server/data/admin.db"
MODE="${1:-empty}"
NOW=$(date +%s)
TODAY_START=$(( (NOW / 86400) * 86400 ))

if [ "$MODE" != "full" ] && [ "$MODE" != "empty" ]; then
  echo "사용법: $0 [full|empty]" >&2
  exit 1
fi

echo "▶ seed mode: $MODE"

# ── 공통: 기존 테스트 데이터 초기화 ──────────────────────────
sqlite3 "$DB" <<SQL
DELETE FROM optimization_events;
DELETE FROM domain_stats;
DELETE FROM dns_metrics_minute;
DELETE FROM domains WHERE host NOT IN ('httpbin.org', '*.textbook.com');
SQL

if [ "$MODE" = "empty" ]; then
  # 빈 상태: 도메인 2건만 유지, 통계 없음
  sqlite3 "$DB" <<SQL
UPDATE domains SET enabled=1;
SQL
  echo "✅ empty 완료 (도메인 2건, 통계 없음)"
  exit 0
fi

# ── full 모드 ────────────────────────────────────────────────

# 도메인 추가 (활성/비활성 혼합)
sqlite3 "$DB" <<SQL
INSERT OR REPLACE INTO domains (host, origin, enabled, created_at) VALUES
  ('textbook.com',        'https://textbook.com',        1, $((NOW - 86400 * 30))),
  ('cdn.school.kr',       'https://origin.school.kr',    1, $((NOW - 86400 * 20))),
  ('video.school.kr',     'https://video-origin.school.kr', 0, $((NOW - 86400 * 15))),
  ('img.school.kr',       'https://img-origin.school.kr', 1, $((NOW - 86400 * 10))),
  ('static.school.kr',    'https://static-origin.school.kr', 0, $((NOW - 86400 * 7))),
  ('api.school.kr',       'https://api-origin.school.kr', 1, $((NOW - 86400 * 5))),
  ('*.cdn.edu.kr',        'https://edu-origin.kr',       1, $((NOW - 86400 * 3)));
SQL

# domain_stats: 오늘 24시간 시계열 (주요 도메인 2개)
python3 - <<PYEOF
import subprocess, random, math

db = "$DB"
hosts = ["httpbin.org", "cdn.school.kr"]
today = $TODAY_START

rows = []
for host in hosts:
    for h in range(24):
        ts = today + h * 3600
        # 시간대별 트래픽 패턴 (오전 9~17시 피크)
        factor = 1 + 3 * math.exp(-((h - 13) ** 2) / 18)
        reqs = int(random.gauss(500 * factor, 80))
        hits = int(reqs * random.uniform(0.6, 0.85))
        misses = reqs - hits
        bw = reqs * random.randint(8000, 80000)
        avg_rt = random.randint(30, 200)
        l1 = int(hits * random.uniform(0.5, 0.75))   # L1 메모리 히트
        l2 = hits - l1                                 # L2 디스크 히트
        bypass_m = int(reqs * 0.03)
        bypass_n = int(reqs * 0.02)
        bypass_s = int(reqs * 0.01)
        bypass_o = int(reqs * 0.01)
        rows.append(f"('{host}',{ts},{reqs},{hits},{misses},{bw},{avg_rt},{l1},{l2},{bypass_m},{bypass_n},{bypass_s},{bypass_o})")

sql = "INSERT OR REPLACE INTO domain_stats (host,timestamp,requests,cache_hits,cache_misses,bandwidth,avg_response_time,l1_hits,l2_hits,bypass_method,bypass_nocache,bypass_size,bypass_other) VALUES " + ",".join(rows) + ";"
subprocess.run(["sqlite3", db], input=sql, text=True, check=True)
print(f"  domain_stats: {len(rows)}행 삽입")
PYEOF

# dns_metrics_minute: 오늘 24시간 분 단위
python3 - <<PYEOF
import subprocess, random, math

db = "$DB"
today = $TODAY_START
rows = []
for h in range(24):
    for m in range(0, 60, 5):  # 5분 간격
        ts = (today + h * 3600 + m * 60) * 1000  # bucket_ts는 epoch ms
        factor = 1 + 2 * math.exp(-((h - 11) ** 2) / 20)
        total = int(random.gauss(200 * factor, 30))
        matched = int(total * random.uniform(0.4, 0.7))
        nxdomain = int(total * random.uniform(0.02, 0.08))
        forwarded = total - matched - nxdomain
        rows.append(f"({ts},{total},{matched},{nxdomain},{forwarded})")

sql = "INSERT OR REPLACE INTO dns_metrics_minute (bucket_ts,total,matched,nxdomain,forwarded) VALUES " + ",".join(rows) + ";"
subprocess.run(["sqlite3", db], input=sql, text=True, check=True)
print(f"  dns_metrics_minute: {len(rows)}행 삽입")
PYEOF

# optimization_events: httpbin.org 최근 50건
python3 - <<PYEOF
import subprocess, random, datetime

db = "$DB"
now = $NOW
urls = [
    "/images/logo.png", "/css/main.css", "/js/app.js",
    "/fonts/noto.woff2", "/images/banner.jpg", "/api/v1/books",
    "/videos/intro.mp4", "/images/thumbnail.jpg"
]
# event_type은 proxy emit 값과 admin-server OptimizationEventType enum에 정확히 일치해야 한다.
# (services/admin-server/src/db/optimization-events-repo.ts:39)
# decision은 event_type별로 의미 있는 분포가 다르므로 매핑 테이블로 분리한다.
# (repo 주석 line 12-14 참조)
event_decision_map = {
    "media_cache":     ["served_200", "served_206", "stored_new", "invalid_range_416"],
    "image_optimize":  ["converted", "rejected_size", "skipped_small", "skipped_type", "error"],
    "text_compress":   ["compressed_br", "compressed_gzip", "skipped_small", "skipped_type", "error"],
}
event_types = list(event_decision_map.keys())
rows = []
for i in range(50):
    ts_val = now - random.randint(0, 86400)
    ts_str = datetime.datetime.utcfromtimestamp(ts_val).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = random.choice(urls)
    et = random.choice(event_types)
    # event_type에 맞는 decision 후보 중 선택 — Phase별 의미 일관성 유지
    dec = random.choice(event_decision_map[et])
    orig = random.randint(50000, 5000000)
    out = int(orig * random.uniform(0.3, 0.9))
    ct = "image/jpeg" if "image" in url else ("text/css" if "css" in url else "application/javascript")
    elapsed = random.randint(5, 300)
    url_hash = hex(abs(hash(url)))[2:18]
    rows.append(f"('{ts_str}','{et}','httpbin.org','{url_hash}','{url}','{dec}',{orig},{out},NULL,'{ct}',{elapsed})")

sql = "INSERT INTO optimization_events (ts,event_type,host,url_hash,url,decision,orig_size,out_size,range_header,content_type,elapsed_ms) VALUES " + ",".join(rows) + ";"
subprocess.run(["sqlite3", db], input=sql, text=True, check=True)
print(f"  optimization_events: {len(rows)}행 삽입")
PYEOF

echo "✅ admin DB 시드 완료"
sqlite3 "$DB" "SELECT 'domains' as t, count(*) FROM domains UNION ALL SELECT 'domain_stats', count(*) FROM domain_stats UNION ALL SELECT 'dns_metrics_minute', count(*) FROM dns_metrics_minute UNION ALL SELECT 'optimization_events', count(*) FROM optimization_events;"

# ── Rust 서비스 in-memory 시드 (#283/#278/#277) ──────────────
# ENABLE_DEV_SEED=true 로 기동된 서비스만 응답. 서비스 미기동 시 silent skip.
echo "▶ Rust 서비스 in-memory 시드 시도"
STORAGE_HEALTH_URL="${STORAGE_HEALTH_URL:-http://localhost:8080}"
DNS_HEALTH_URL="${DNS_HEALTH_URL:-http://localhost:8082}"
PROXY_ADMIN_URL="${PROXY_ADMIN_URL:-http://localhost:8081}"

curl -fsS -X POST "$STORAGE_HEALTH_URL/dev/seed" 2>/dev/null && echo "  storage-service /dev/seed OK" \
  || echo "  storage-service /dev/seed skip (미기동 또는 ENABLE_DEV_SEED 미설정)"
curl -fsS -X POST "$DNS_HEALTH_URL/dev/seed" 2>/dev/null && echo "  dns-service /dev/seed OK" \
  || echo "  dns-service /dev/seed skip (미기동 또는 ENABLE_DEV_SEED 미설정)"
curl -fsS -X POST "$PROXY_ADMIN_URL/dev/seed" 2>/dev/null && echo "  proxy /admin/dev/seed OK" \
  || echo "  proxy /admin/dev/seed skip (미기동 또는 ENABLE_DEV_SEED 미설정)"
echo "✅ full 완료"
