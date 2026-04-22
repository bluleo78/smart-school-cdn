/// 디스크 캐시 레이어
/// - SHA-256 키 기반 캐시 항목 저장/조회/퇴거
/// - Cache-Control / Pragma 헤더 파싱으로 TTL 결정
/// - LRU 퇴거 정책으로 최대 용량 제어

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use bytes::Bytes;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

/// Phase 20: 저장 헤더 사이드카 파일 확장자
const HEADERS_SIDECAR_EXT: &str = "headers.json";

/// Phase 20: 저장 헤더 JSON 직렬화 후 바이트 상한
const MAX_CACHED_HEADERS_BYTES: usize = 8 * 1024;

// ─── 캐시 키 계산 ────────────────────────────────────────────────

/// HTTP 요청에서 캐시 키 계산 — SHA-256 hex string 반환
/// 입력 형식: "{method}:{host}{path}?{query}"
pub fn compute_cache_key(method: &str, host: &str, path: &str, query: &str) -> String {
    let input = format!("{method}:{host}{path}?{query}");
    let hash = Sha256::digest(input.as_bytes());
    hex::encode(hash)
}

// ─── Cache-Control 파싱 ──────────────────────────────────────────

/// Cache-Control 헤더 해석 결과
#[derive(Debug, PartialEq)]
pub enum CacheDirective {
    /// 캐시 불가 (no-store / no-cache / private / Pragma:no-cache)
    NoStore,
    /// 캐시 가능 — TTL이 None이면 만료 없음
    Cacheable(Option<Duration>),
}

/// Cache-Control 및 Pragma 헤더를 파싱해 캐싱 지시자 반환
/// - s-maxage > max-age 우선순위
/// - no-store / no-cache / private → NoStore
/// - Pragma: no-cache → NoStore
/// - 헤더 없음 → Cacheable(None)
pub fn parse_cache_control(
    cache_control: Option<&str>,
    pragma: Option<&str>,
) -> CacheDirective {
    // Pragma: no-cache 처리 (Cache-Control 없을 때 폴백)
    if cache_control.is_none() {
        if let Some(p) = pragma {
            if p.contains("no-cache") {
                return CacheDirective::NoStore;
            }
        }
        return CacheDirective::Cacheable(None);
    }

    let cc = cache_control.unwrap();

    // 캐시 불가 지시자 확인
    for directive in cc.split(',').map(str::trim) {
        let lower = directive.to_lowercase();
        if lower == "no-store" || lower == "no-cache" || lower == "private" {
            return CacheDirective::NoStore;
        }
    }

    // s-maxage 파싱 (max-age보다 우선)
    let s_maxage = parse_duration_directive(cc, "s-maxage");
    if s_maxage.is_some() {
        return CacheDirective::Cacheable(s_maxage);
    }

    // max-age 파싱
    let max_age = parse_duration_directive(cc, "max-age");
    if max_age.is_some() {
        return CacheDirective::Cacheable(max_age);
    }

    CacheDirective::Cacheable(None)
}

/// "directive=N" 형태에서 Duration 추출
/// `=`으로 분리 후 이름만 정확히 비교 — prefix match 방지
fn parse_duration_directive(cc: &str, directive: &str) -> Option<Duration> {
    for part in cc.split(',').map(str::trim) {
        let (name, value) = match part.find('=') {
            Some(pos) => (part[..pos].trim(), Some(part[pos + 1..].trim())),
            None => (part.trim(), None),
        };
        if name.to_lowercase() == directive {
            if let Some(v) = value {
                if let Ok(secs) = v.parse::<u64>() {
                    return Some(Duration::from_secs(secs));
                }
            }
        }
    }
    None
}

// ─── 캐시 항목 ───────────────────────────────────────────────────

/// 캐시된 콘텐츠의 메타데이터
#[derive(Debug, Clone, Serialize)]
pub struct CacheEntry {
    /// 전체 URL (https://host/path)
    pub url: String,
    /// 도메인 (퇴거/통계 단위)
    pub domain: String,
    /// Content-Type
    pub content_type: Option<String>,
    /// 콘텐츠 크기 (바이트)
    pub size_bytes: u64,
    /// 캐시 HIT 횟수
    pub hit_count: u64,
    /// 캐시 저장 시각
    pub created_at: DateTime<Utc>,
    /// 마지막 접근 시각 (LRU 기준)
    pub accessed_at: DateTime<Utc>,
    /// 만료 시각 — None이면 만료 없음
    pub expires_at: Option<DateTime<Utc>>,
    /// Phase 15: Brotli 프리컴프레스 변형 존재 여부
    pub has_br: bool,
    /// Phase 20: origin 응답 헤더 화이트리스트 저장분 (소문자 이름)
    pub cached_headers: Vec<(String, String)>,
}

impl CacheEntry {
    /// TTL이 지났으면 true
    pub fn is_expired(&self) -> bool {
        match self.expires_at {
            Some(exp) => Utc::now() > exp,
            None => false,
        }
    }
}

// ─── 도메인 통계 ─────────────────────────────────────────────────

/// 도메인별 캐시 통계 요약
#[derive(Debug, Serialize)]
pub struct DomainStats {
    pub domain: String,
    pub hit_count: u64,
    pub size_bytes: u64,
}

// ─── CacheLayer ──────────────────────────────────────────────────

/// 디스크 기반 캐시 레이어
/// - 인메모리 인덱스 + 디스크 파일로 콘텐츠 저장
/// - max_size_bytes 초과 시 LRU 퇴거
pub struct CacheLayer {
    /// 캐시 키 → 메타데이터 인덱스
    index: Mutex<HashMap<String, CacheEntry>>,
    /// 캐시 파일 저장 디렉터리
    pub cache_dir: PathBuf,
    /// 최대 허용 캐시 크기 (바이트)
    pub max_size_bytes: u64,
    /// 현재 캐시 크기 (바이트) — 원자적 접근
    current_size: AtomicU64,
}

impl CacheLayer {
    /// 새 CacheLayer 생성 — cache_dir이 없으면 자동 생성
    pub fn new(cache_dir: PathBuf, max_size_bytes: u64) -> Self {
        // 디렉터리 생성 실패는 무시 (이미 존재하는 경우 포함)
        let _ = std::fs::create_dir_all(&cache_dir);
        Self {
            index: Mutex::new(HashMap::new()),
            cache_dir,
            max_size_bytes,
            current_size: AtomicU64::new(0),
        }
    }

    /// 캐시 조회 — HIT 시 (Bytes, content_type, body_br, cached_headers) 반환, MISS/만료 시 None
    pub async fn get(
        &self,
        key: &str,
    ) -> Option<(Bytes, Option<String>, Option<Bytes>, Vec<(String, String)>)> {
        // 1단계: lock 안 — 인덱스 확인·수정만 수행, 경로만 추출
        enum LookupResult {
            Expired(PathBuf),
            Hit(PathBuf, Option<String>, bool, Vec<(String, String)>),
        }

        let result = {
            let mut index = self.index.lock().await;
            let entry = index.get_mut(key)?;

            if entry.is_expired() {
                // 만료: 인덱스에서 제거 + 크기 업데이트
                let size = entry.size_bytes;
                let path = self.cache_dir.join(key);
                index.remove(key);
                self.current_size.fetch_sub(size, Ordering::Relaxed);
                LookupResult::Expired(path)
            } else {
                // HIT: 통계 갱신
                entry.hit_count += 1;
                entry.accessed_at = Utc::now();
                let content_type = entry.content_type.clone();
                let has_br = entry.has_br;
                let cached_headers = entry.cached_headers.clone();
                let path = self.cache_dir.join(key);
                LookupResult::Hit(path, content_type, has_br, cached_headers)
            }
        }; // lock 해제

        // 2단계: lock 밖 — 디스크 I/O 수행
        match result {
            LookupResult::Expired(path) => {
                let _ = tokio::fs::remove_file(&path).await;
                let _ = tokio::fs::remove_file(path.with_extension("br")).await;
                let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{key}.{HEADERS_SIDECAR_EXT}"))).await;
                None
            }
            LookupResult::Hit(path, content_type, has_br, cached_headers) => {
                match tokio::fs::read(&path).await {
                    Ok(data) => {
                        // body_br 파일 읽기 (없으면 None)
                        let body_br = if has_br {
                            let br_path = path.with_extension("br");
                            tokio::fs::read(&br_path).await.ok().map(Bytes::from)
                        } else {
                            None
                        };
                        Some((Bytes::from(data), content_type, body_br, cached_headers))
                    }
                    Err(_) => {
                        // Fix 3: 디스크 파일 없으면 stale 인덱스 제거
                        let mut index = self.index.lock().await;
                        if let Some(entry) = index.remove(key) {
                            self.current_size.fetch_sub(entry.size_bytes, Ordering::Relaxed);
                        }
                        None
                    }
                }
            }
        }
    }

    /// 캐시 저장 — 용량 초과 시 LRU 퇴거 후 저장
    /// 저장 실패는 무시 (best-effort)
    /// body_br: Phase 15 Brotli 프리컴프레스 변형 (Some이면 {key}.br 파일로 함께 저장)
    /// cached_headers: Phase 20 origin 응답 헤더 화이트리스트 — {key}.headers.json 사이드카로 저장
    #[allow(clippy::too_many_arguments)]
    pub async fn put(
        &self,
        key: &str,
        url: &str,
        domain: &str,
        content_type: Option<String>,
        bytes: Bytes,
        ttl: Option<Duration>,
        body_br: Option<Bytes>,
        cached_headers: Vec<(String, String)>,
    ) {
        let size = bytes.len() as u64;

        // 단일 항목이 최대 용량보다 크면 저장 불가
        if size > self.max_size_bytes {
            return;
        }

        // 용량 초과 시 LRU 퇴거
        let current = self.current_size.load(Ordering::Relaxed);
        if current + size > self.max_size_bytes {
            let needed = (current + size) - self.max_size_bytes;
            self.evict_lru(needed).await;
        }

        // 디스크에 파일 저장
        let path = self.cache_dir.join(key);
        if tokio::fs::write(&path, &bytes).await.is_err() {
            return;
        }

        // body_br 사이드카 파일 저장 (실패해도 진행)
        let has_br = if let Some(ref br_bytes) = body_br {
            if !br_bytes.is_empty() {
                let br_path = path.with_extension("br");
                tokio::fs::write(&br_path, br_bytes).await.is_ok()
            } else {
                false
            }
        } else {
            false
        };

        // Phase 20: cached_headers 사이드카 파일 저장 (best-effort, 크기 상한 초과 시 skip)
        if !cached_headers.is_empty() {
            if let Ok(json) = serde_json::to_vec(&cached_headers) {
                if json.len() <= MAX_CACHED_HEADERS_BYTES {
                    let sidecar = self.cache_dir.join(format!("{key}.{HEADERS_SIDECAR_EXT}"));
                    let _ = tokio::fs::write(&sidecar, &json).await;
                }
            }
        }

        // 인덱스 등록
        let now = Utc::now();
        let expires_at = ttl.map(|d| now + chrono::Duration::from_std(d).unwrap_or_default());

        let entry = CacheEntry {
            url: url.to_string(),
            domain: domain.to_string(),
            content_type,
            size_bytes: size,
            hit_count: 0,
            created_at: now,
            accessed_at: now,
            expires_at,
            has_br,
            cached_headers,
        };

        let mut index = self.index.lock().await;

        // Fix 2: TOCTOU — 디스크 쓰기 후 다른 put이 공간을 채웠을 수 있으므로 재확인
        // 기존 항목이 있으면 크기 차감 후 순수 증분으로 검사
        let old_size = index.get(key).map(|e| e.size_bytes).unwrap_or(0);
        let net_increase = size.saturating_sub(old_size);
        if self.current_size.load(Ordering::Relaxed) + net_increase > self.max_size_bytes {
            // 공간 부족 — 파일 롤백
            drop(index);
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{key}.{HEADERS_SIDECAR_EXT}"))).await;
            return;
        }

        // 기존 항목 교체 시 크기 차감
        if let Some(old) = index.remove(key) {
            self.current_size.fetch_sub(old.size_bytes, Ordering::Relaxed);
        }

        index.insert(key.to_string(), entry);
        self.current_size.fetch_add(size, Ordering::Relaxed);
    }

    /// LRU 퇴거 — accessed_at 오름차순으로 오래된 항목 삭제
    pub async fn evict_lru(&self, needed_bytes: u64) {
        // 1단계: lock 안 — 인덱스 수정만 수행, 삭제할 경로 수집
        let paths_to_delete: Vec<PathBuf> = {
            let mut index = self.index.lock().await;

            // accessed_at 오름차순 정렬
            let mut entries: Vec<(String, DateTime<Utc>, u64)> = index
                .iter()
                .map(|(k, e)| (k.clone(), e.accessed_at, e.size_bytes))
                .collect();
            entries.sort_by_key(|(_, accessed, _)| *accessed);

            let mut freed = 0u64;
            let mut paths = Vec::new();
            for (key, _, size) in entries {
                if freed >= needed_bytes {
                    break;
                }
                index.remove(&key);
                self.current_size.fetch_sub(size, Ordering::Relaxed);
                paths.push(self.cache_dir.join(&key));
                freed += size;
            }
            paths
        }; // lock 해제

        // 2단계: lock 밖 — 디스크 I/O 수행 (body + br + headers 사이드카)
        for path in paths_to_delete {
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(path.with_extension("br")).await;
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{name}.{HEADERS_SIDECAR_EXT}"))).await;
            }
        }
    }

    /// 키로 단일 항목 삭제 — (삭제 항목 수, 해제 바이트 수) 반환
    pub async fn purge_by_key(&self, key: &str) -> (u64, u64) {
        // 1단계: lock 안 — 인덱스 수정
        let maybe_path = {
            let mut index = self.index.lock().await;
            if let Some(entry) = index.remove(key) {
                let size = entry.size_bytes;
                self.current_size.fetch_sub(size, Ordering::Relaxed);
                Some((self.cache_dir.join(key), size))
            } else {
                None
            }
        }; // lock 해제

        // 2단계: lock 밖 — 디스크 I/O (body + br + headers 사이드카)
        if let Some((path, size)) = maybe_path {
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(path.with_extension("br")).await;
            let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{key}.{HEADERS_SIDECAR_EXT}"))).await;
            (1, size)
        } else {
            (0, 0)
        }
    }

    /// URL로 항목 삭제 — (삭제 항목 수, 해제 바이트 수) 반환
    pub async fn purge_by_url(&self, url: &str) -> (u64, u64) {
        // 1단계: lock 안 — 인덱스 수정, 경로 수집
        let (count, freed, paths) = {
            let mut index = self.index.lock().await;
            let keys: Vec<String> = index
                .iter()
                .filter(|(_, e)| e.url == url)
                .map(|(k, _)| k.clone())
                .collect();

            let mut count = 0u64;
            let mut freed = 0u64;
            let mut paths = Vec::new();
            for key in keys {
                if let Some(entry) = index.remove(&key) {
                    freed += entry.size_bytes;
                    count += 1;
                    self.current_size.fetch_sub(entry.size_bytes, Ordering::Relaxed);
                    paths.push(self.cache_dir.join(&key));
                }
            }
            (count, freed, paths)
        }; // lock 해제

        // 2단계: lock 밖 — 디스크 I/O (body + br + headers 사이드카)
        for path in paths {
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(path.with_extension("br")).await;
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{name}.{HEADERS_SIDECAR_EXT}"))).await;
            }
        }
        (count, freed)
    }

    /// 도메인 전체 삭제 — (삭제 항목 수, 해제 바이트 수) 반환
    pub async fn purge_domain(&self, domain: &str) -> (u64, u64) {
        // 1단계: lock 안 — 인덱스 수정, 경로 수집
        let (count, freed, paths) = {
            let mut index = self.index.lock().await;
            let keys: Vec<String> = index
                .iter()
                .filter(|(_, e)| e.domain == domain)
                .map(|(k, _)| k.clone())
                .collect();

            let mut count = 0u64;
            let mut freed = 0u64;
            let mut paths = Vec::new();
            for key in keys {
                if let Some(entry) = index.remove(&key) {
                    freed += entry.size_bytes;
                    count += 1;
                    self.current_size.fetch_sub(entry.size_bytes, Ordering::Relaxed);
                    paths.push(self.cache_dir.join(&key));
                }
            }
            (count, freed, paths)
        }; // lock 해제

        // 2단계: lock 밖 — 디스크 I/O (body + br + headers 사이드카)
        for path in paths {
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(path.with_extension("br")).await;
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{name}.{HEADERS_SIDECAR_EXT}"))).await;
            }
        }
        (count, freed)
    }

    /// 전체 캐시 삭제 — (삭제 항목 수, 해제 바이트 수) 반환
    pub async fn purge_all(&self) -> (u64, u64) {
        // 1단계: lock 안 — 인덱스 초기화, 경로 수집
        let (count, freed, paths) = {
            let mut index = self.index.lock().await;
            let count = index.len() as u64;
            let freed: u64 = index.values().map(|e| e.size_bytes).sum();
            let paths: Vec<PathBuf> = index.keys().map(|k| self.cache_dir.join(k)).collect();
            index.clear();
            self.current_size.store(0, Ordering::Relaxed);
            (count, freed, paths)
        }; // lock 해제

        // 2단계: lock 밖 — 디스크 I/O (body + br + headers 사이드카)
        for path in paths {
            let _ = tokio::fs::remove_file(&path).await;
            let _ = tokio::fs::remove_file(path.with_extension("br")).await;
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                let _ = tokio::fs::remove_file(self.cache_dir.join(format!("{name}.{HEADERS_SIDECAR_EXT}"))).await;
            }
        }
        (count, freed)
    }

    /// 도메인별 통계 집계
    pub async fn get_domain_stats(&self) -> Vec<DomainStats> {
        let index = self.index.lock().await;
        let mut map: HashMap<String, DomainStats> = HashMap::new();

        for entry in index.values() {
            let stat = map.entry(entry.domain.clone()).or_insert(DomainStats {
                domain: entry.domain.clone(),
                hit_count: 0,
                size_bytes: 0,
            });
            stat.hit_count += entry.hit_count;
            stat.size_bytes += entry.size_bytes;
        }

        map.into_values().collect()
    }

    /// 인기 콘텐츠 조회 — hit_count 내림차순
    pub async fn get_popular(&self, limit: usize) -> Vec<CacheEntry> {
        let index = self.index.lock().await;
        let mut entries: Vec<CacheEntry> = index.values().cloned().collect();
        entries.sort_by(|a, b| b.hit_count.cmp(&a.hit_count));
        entries.truncate(limit);
        entries
    }

    /// 현재 캐시 크기 (바이트)
    pub fn current_size_bytes(&self) -> u64 {
        self.current_size.load(Ordering::Relaxed)
    }

    /// 캐시된 항목 수
    pub async fn entry_count(&self) -> u64 {
        self.index.lock().await.len() as u64
    }
}

// ─── 단위 테스트 ─────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_cache(tmp: &TempDir, max_bytes: u64) -> CacheLayer {
        CacheLayer::new(tmp.path().to_path_buf(), max_bytes)
    }

    // ── compute_cache_key ────────────────────────────────────────

    #[test]
    fn test_cache_key_deterministic() {
        let k1 = compute_cache_key("GET", "example.com", "/foo", "bar=1");
        let k2 = compute_cache_key("GET", "example.com", "/foo", "bar=1");
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), 64); // SHA-256 hex = 64자
    }

    #[test]
    fn test_cache_key_different_method() {
        let get = compute_cache_key("GET", "example.com", "/foo", "");
        let post = compute_cache_key("POST", "example.com", "/foo", "");
        assert_ne!(get, post);
    }

    // ── parse_cache_control ──────────────────────────────────────

    #[test]
    fn test_no_store() {
        assert_eq!(
            parse_cache_control(Some("no-store"), None),
            CacheDirective::NoStore
        );
    }

    #[test]
    fn test_no_cache() {
        assert_eq!(
            parse_cache_control(Some("no-cache"), None),
            CacheDirective::NoStore
        );
    }

    #[test]
    fn test_private() {
        assert_eq!(
            parse_cache_control(Some("private"), None),
            CacheDirective::NoStore
        );
    }

    #[test]
    fn test_max_age() {
        assert_eq!(
            parse_cache_control(Some("max-age=300"), None),
            CacheDirective::Cacheable(Some(Duration::from_secs(300)))
        );
    }

    #[test]
    fn test_s_maxage_beats_max_age() {
        // s-maxage=600이 max-age=300보다 우선
        assert_eq!(
            parse_cache_control(Some("max-age=300, s-maxage=600"), None),
            CacheDirective::Cacheable(Some(Duration::from_secs(600)))
        );
    }

    #[test]
    fn test_no_header() {
        assert_eq!(
            parse_cache_control(None, None),
            CacheDirective::Cacheable(None)
        );
    }

    #[test]
    fn test_pragma_no_cache() {
        assert_eq!(
            parse_cache_control(None, Some("no-cache")),
            CacheDirective::NoStore
        );
    }

    // ── CacheLayer ───────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_missing_key() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);
        assert!(cache.get("nonexistent").await.is_none());
    }

    #[tokio::test]
    async fn test_put_then_get_hit() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);
        let key = compute_cache_key("GET", "example.com", "/index.html", "");
        let data = Bytes::from("hello world");

        cache
            .put(
                &key,
                "https://example.com/index.html",
                "example.com",
                Some("text/html".to_string()),
                data.clone(),
                None,
                None,
                vec![],
            )
            .await;

        let result = cache.get(&key).await;
        assert!(result.is_some());
        let (body, ct, _body_br, _hdrs) = result.unwrap();
        assert_eq!(body, data);
        assert_eq!(ct, Some("text/html".to_string()));
    }

    #[tokio::test]
    async fn test_hit_count_increments() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);
        let key = compute_cache_key("GET", "example.com", "/a", "");

        cache
            .put(
                &key,
                "https://example.com/a",
                "example.com",
                None,
                Bytes::from("data"),
                None,
                None,
                vec![],
            )
            .await;

        cache.get(&key).await;
        cache.get(&key).await;

        let index = cache.index.lock().await;
        assert_eq!(index[&key].hit_count, 2);
    }

    #[tokio::test]
    async fn test_ttl_expiry() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);
        let key = compute_cache_key("GET", "example.com", "/ttl", "");

        // TTL = 0초 → 즉시 만료
        cache
            .put(
                &key,
                "https://example.com/ttl",
                "example.com",
                None,
                Bytes::from("expires"),
                Some(Duration::from_secs(0)),
                None,
                vec![],
            )
            .await;

        // Duration(0)은 즉시 만료
        let result = cache.get(&key).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_lru_eviction() {
        let tmp = TempDir::new().unwrap();
        // 최대 15바이트 → 10바이트 항목 저장 후 10바이트 추가 시 퇴거 발생
        let cache = make_cache(&tmp, 15);

        let key1 = compute_cache_key("GET", "a.com", "/1", "");
        let key2 = compute_cache_key("GET", "a.com", "/2", "");

        // key1 먼저 저장 (accessed_at이 더 오래됨)
        cache
            .put(
                &key1,
                "https://a.com/1",
                "a.com",
                None,
                Bytes::from("0123456789"), // 10바이트
                None,
                None,
                vec![],
            )
            .await;

        // key2 저장 → 용량 초과, key1 퇴거
        cache
            .put(
                &key2,
                "https://a.com/2",
                "a.com",
                None,
                Bytes::from("0123456789"), // 10바이트
                None,
                None,
                vec![],
            )
            .await;

        // key1은 퇴거되고 key2는 남아있어야 함
        assert!(cache.get(&key1).await.is_none());
        assert!(cache.get(&key2).await.is_some());
    }

    #[tokio::test]
    async fn test_purge_by_key() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);

        let key1 = compute_cache_key("GET", "b.com", "/1", "");
        let key2 = compute_cache_key("GET", "b.com", "/2", "");

        for key in &[&key1, &key2] {
            cache
                .put(key, "https://b.com/x", "b.com", None, Bytes::from("data"), None, None, vec![])
                .await;
        }

        let (count, _) = cache.purge_by_key(&key1).await;
        assert_eq!(count, 1);
        assert!(cache.get(&key1).await.is_none());
        assert!(cache.get(&key2).await.is_some());
    }

    #[tokio::test]
    async fn test_purge_domain() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);

        let k1 = compute_cache_key("GET", "c.com", "/1", "");
        let k2 = compute_cache_key("GET", "c.com", "/2", "");
        let k3 = compute_cache_key("GET", "d.com", "/1", "");

        cache
            .put(&k1, "https://c.com/1", "c.com", None, Bytes::from("x"), None, None, vec![])
            .await;
        cache
            .put(&k2, "https://c.com/2", "c.com", None, Bytes::from("y"), None, None, vec![])
            .await;
        cache
            .put(&k3, "https://d.com/1", "d.com", None, Bytes::from("z"), None, None, vec![])
            .await;

        let (count, _) = cache.purge_domain("c.com").await;
        assert_eq!(count, 2);
        assert!(cache.get(&k1).await.is_none());
        assert!(cache.get(&k2).await.is_none());
        assert!(cache.get(&k3).await.is_some()); // d.com은 유지
    }

    #[tokio::test]
    async fn test_purge_all() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);

        for i in 0..3 {
            let key = compute_cache_key("GET", "e.com", &format!("/{i}"), "");
            cache
                .put(&key, "https://e.com/x", "e.com", None, Bytes::from("data"), None, None, vec![])
                .await;
        }

        let (count, _) = cache.purge_all().await;
        assert_eq!(count, 3);
        assert_eq!(cache.entry_count().await, 0);
        assert_eq!(cache.current_size_bytes(), 0);
    }

    #[tokio::test]
    async fn purge_by_url은_url로_항목을_삭제한다() {
        let tmp = TempDir::new().unwrap();
        let cache = make_cache(&tmp, 10 * 1024 * 1024);
        let key = compute_cache_key("GET", "f.com", "/file", "");
        cache
            .put(
                &key,
                "https://f.com/file",
                "f.com",
                None,
                Bytes::from("data"),
                None,
                None,
                vec![],
            )
            .await;

        let (count, freed) = cache.purge_by_url("https://f.com/file").await;
        assert_eq!(count, 1);
        assert!(freed > 0);
        assert!(cache.get(&key).await.is_none());
    }

    // ── Phase 20: cached_headers 사이드카 ─────────────────────────

    #[tokio::test]
    async fn put_후_get에서_cached_headers를_함께_반환한다() {
        let dir = TempDir::new().unwrap();
        let cache = CacheLayer::new(dir.path().to_path_buf(), 100 * 1024 * 1024);

        let headers = vec![
            ("cache-control".to_string(), "max-age=3600".to_string()),
            ("etag".to_string(), "\"v7\"".to_string()),
        ];

        cache
            .put(
                "k-hdr",
                "https://a.test/x",
                "a.test",
                Some("text/html".to_string()),
                Bytes::from_static(b"<!doctype html>"),
                None,
                None,
                headers.clone(),
            )
            .await;

        let (body, ct, br, got_headers) = cache.get("k-hdr").await.unwrap();
        assert_eq!(body, Bytes::from_static(b"<!doctype html>"));
        assert_eq!(ct.as_deref(), Some("text/html"));
        assert!(br.is_none());
        assert_eq!(got_headers, headers);
    }

    #[tokio::test]
    async fn cached_headers_없이_저장하면_get은_빈_vec를_반환한다() {
        let dir = TempDir::new().unwrap();
        let cache = CacheLayer::new(dir.path().to_path_buf(), 100 * 1024 * 1024);

        cache
            .put(
                "k-empty",
                "https://a.test/y",
                "a.test",
                Some("image/png".to_string()),
                Bytes::from_static(b"PNG_DATA"),
                None,
                None,
                vec![],
            )
            .await;

        let (_, _, _, got_headers) = cache.get("k-empty").await.unwrap();
        assert!(got_headers.is_empty());
    }

    #[tokio::test]
    async fn purge_by_key_는_사이드카_파일도_삭제한다() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().to_path_buf();
        let cache = CacheLayer::new(cache_dir.clone(), 100 * 1024 * 1024);

        cache
            .put(
                "k-purge",
                "https://a.test/z",
                "a.test",
                None,
                Bytes::from_static(b"x"),
                None,
                None,
                vec![("etag".to_string(), "\"v\"".to_string())],
            )
            .await;

        let sidecar = cache_dir.join("k-purge.headers.json");
        assert!(sidecar.exists(), "사이드카 파일이 생성되어야 함");

        cache.purge_by_key("k-purge").await;
        assert!(!sidecar.exists(), "퍼지 후 사이드카 파일이 삭제되어야 함");
    }
}
