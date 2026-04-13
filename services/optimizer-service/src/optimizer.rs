/// Optimizer 핵심 로직
/// - SQLite: 도메인별 프로파일 + 절감 통계
/// - optimize(): 이미지 WebP 변환 + 텍스트 gzip 압축
use flate2::{write::GzEncoder, Compression};
use rusqlite::{Connection, params};
use std::io::Write;
use std::sync::Mutex;

/// 최적화 결과
pub struct OptimizeResult {
    pub data:           Vec<u8>,
    pub content_type:   String,
    pub original_size:  i64,
    pub optimized_size: i64,
}

/// 도메인 프로파일
pub struct Profile {
    pub quality:   u32,
    pub max_width: u32,
    pub enabled:   bool,
}

/// 도메인 절감 통계
pub struct DomainStat {
    pub domain:          String,
    pub original_bytes:  i64,
    pub optimized_bytes: i64,
    pub count:           i64,
}

/// SQLite 기반 프로파일 + 통계 저장소
pub struct OptimizerDb {
    conn: Mutex<Connection>,
}

impl OptimizerDb {
    /// DB 파일을 열고 스키마를 초기화한다
    pub fn open(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        // DB 디렉터리가 없으면 생성
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS profiles (
                domain    TEXT PRIMARY KEY,
                quality   INTEGER NOT NULL DEFAULT 85,
                max_width INTEGER NOT NULL DEFAULT 0,
                enabled   INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS optimization_stats (
                domain          TEXT PRIMARY KEY,
                original_bytes  INTEGER NOT NULL DEFAULT 0,
                optimized_bytes INTEGER NOT NULL DEFAULT 0,
                count           INTEGER NOT NULL DEFAULT 0,
                updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ")?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// 도메인 프로파일 조회 — 없으면 기본값 반환
    pub fn get_profile(&self, domain: &str) -> Profile {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT quality, max_width, enabled FROM profiles WHERE domain = ?1",
            params![domain],
            |row| Ok(Profile {
                quality:   row.get::<_, u32>(0)?,
                max_width: row.get::<_, u32>(1)?,
                enabled:   row.get::<_, bool>(2)?,
            }),
        ).unwrap_or(Profile { quality: 85, max_width: 0, enabled: true })
    }

    /// 도메인 프로파일 저장 (INSERT OR REPLACE)
    pub fn set_profile(&self, domain: &str, quality: u32, max_width: u32, enabled: bool) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO profiles (domain, quality, max_width, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![domain, quality, max_width, enabled as i32],
        )?;
        Ok(())
    }

    /// 모든 프로파일 목록 반환
    pub fn get_all_profiles(&self) -> Result<Vec<(String, Profile)>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT domain, quality, max_width, enabled FROM profiles ORDER BY domain"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                Profile {
                    quality:   row.get::<_, u32>(1)?,
                    max_width: row.get::<_, u32>(2)?,
                    enabled:   row.get::<_, bool>(3)?,
                },
            ))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// 모든 도메인 통계 반환
    pub fn get_all_stats(&self) -> Result<Vec<DomainStat>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT domain, original_bytes, optimized_bytes, count FROM optimization_stats ORDER BY domain"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DomainStat {
                domain:          row.get(0)?,
                original_bytes:  row.get(1)?,
                optimized_bytes: row.get(2)?,
                count:           row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// 통계 누적 업데이트
    fn update_stats(&self, domain: &str, original_size: i64, optimized_size: i64) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO optimization_stats (domain, original_bytes, optimized_bytes, count)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(domain) DO UPDATE SET
               original_bytes  = original_bytes  + excluded.original_bytes,
               optimized_bytes = optimized_bytes + excluded.optimized_bytes,
               count           = count + 1,
               updated_at      = datetime('now')",
            params![domain, original_size, optimized_size],
        ).ok();
    }

    /// 콘텐츠 최적화
    /// - image/png, image/jpeg → WebP 변환 (max_width 리사이즈 포함)
    /// - image/webp, image/avif → 바이패스
    /// - text/*, application/javascript, application/json → gzip 압축
    /// - 그 외 → 바이패스
    pub fn optimize(&self, data: &[u8], content_type: &str, domain: &str) -> OptimizeResult {
        let original_size = data.len() as i64;
        let profile = self.get_profile(domain);

        // 프로파일 비활성화 시 바이패스
        if !profile.enabled {
            return OptimizeResult {
                data: data.to_vec(),
                content_type: content_type.to_string(),
                original_size,
                optimized_size: original_size,
            };
        }

        let (out_data, out_type) = match content_type {
            "image/png" | "image/jpeg" => {
                self.convert_to_webp(data, &profile)
                    .unwrap_or_else(|_| (data.to_vec(), content_type.to_string()))
            }
            "image/webp" | "image/avif" => (data.to_vec(), content_type.to_string()),
            ct if ct.starts_with("text/")
                || ct == "application/javascript"
                || ct == "application/json" => {
                self.gzip_compress(data)
                    .unwrap_or_else(|_| (data.to_vec(), content_type.to_string()))
            }
            _ => (data.to_vec(), content_type.to_string()),
        };

        let optimized_size = out_data.len() as i64;
        self.update_stats(domain, original_size, optimized_size);

        OptimizeResult {
            data:           out_data,
            content_type:   out_type,
            original_size,
            optimized_size,
        }
    }

    /// PNG/JPEG → WebP 변환 (max_width 리사이즈 포함)
    fn convert_to_webp(&self, data: &[u8], profile: &Profile) -> Result<(Vec<u8>, String), Box<dyn std::error::Error>> {
        let mut img = image::load_from_memory(data)?;

        // max_width 리사이즈
        if profile.max_width > 0 && img.width() > profile.max_width {
            img = img.resize(profile.max_width, u32::MAX, image::imageops::FilterType::Lanczos3);
        }

        // WebP 인코딩
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::WebP)?;
        Ok((buf, "image/webp".to_string()))
    }

    /// 텍스트 → gzip 압축
    fn gzip_compress(&self, data: &[u8]) -> Result<(Vec<u8>, String), Box<dyn std::error::Error>> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data)?;
        Ok((encoder.finish()?, "application/gzip".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_db() -> (OptimizerDb, TempDir) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.db");
        let db = OptimizerDb::open(path.to_str().unwrap()).unwrap();
        (db, dir)
    }

    // ── 프로파일 DB 테스트 ─────────────────────────────────────────

    #[test]
    fn 프로파일이_없으면_기본값을_반환한다() {
        let (db, _dir) = make_db();
        let p = db.get_profile("unknown.com");
        assert_eq!(p.quality, 85);
        assert_eq!(p.max_width, 0);
        assert!(p.enabled);
    }

    #[test]
    fn 프로파일_저장_후_조회된다() {
        let (db, _dir) = make_db();
        db.set_profile("example.com", 75, 1280, true).unwrap();
        let p = db.get_profile("example.com");
        assert_eq!(p.quality, 75);
        assert_eq!(p.max_width, 1280);
    }

    #[test]
    fn get_all_profiles_는_저장된_목록을_반환한다() {
        let (db, _dir) = make_db();
        db.set_profile("a.com", 80, 0, true).unwrap();
        db.set_profile("b.com", 60, 800, false).unwrap();
        let profiles = db.get_all_profiles().unwrap();
        assert_eq!(profiles.len(), 2);
    }

    #[test]
    fn enabled_false_프로파일은_최적화를_바이패스한다() {
        let (db, _dir) = make_db();
        db.set_profile("example.com", 85, 0, false).unwrap();
        let jpeg = make_test_jpeg();
        let result = db.optimize(&jpeg, "image/jpeg", "example.com");
        assert_eq!(result.data, jpeg);
        assert_eq!(result.content_type, "image/jpeg");
    }

    #[test]
    fn jpeg_입력은_webp로_변환된다() {
        let (db, _dir) = make_db();
        let jpeg = make_test_jpeg();
        let result = db.optimize(&jpeg, "image/jpeg", "unknown.com");
        assert_eq!(result.content_type, "image/webp");
        assert!(result.optimized_size > 0);
    }

    #[test]
    fn png_입력은_webp로_변환된다() {
        let (db, _dir) = make_db();
        let png = make_test_png();
        let result = db.optimize(&png, "image/png", "unknown.com");
        assert_eq!(result.content_type, "image/webp");
    }

    #[test]
    fn webp_입력은_바이패스된다() {
        let (db, _dir) = make_db();
        let data = b"RIFF\x00\x00\x00\x00WEBP".to_vec();
        let result = db.optimize(&data, "image/webp", "unknown.com");
        assert_eq!(result.data, data);
        assert_eq!(result.content_type, "image/webp");
    }

    #[test]
    fn 텍스트_입력은_gzip으로_압축된다() {
        let (db, _dir) = make_db();
        let text = b"hello world ".repeat(100);
        let result = db.optimize(&text, "text/html", "unknown.com");
        // gzip magic bytes: 1f 8b
        assert_eq!(result.data[0], 0x1f);
        assert_eq!(result.data[1], 0x8b);
        assert!(result.optimized_size < result.original_size);
    }

    #[test]
    fn 알수없는_타입은_바이패스된다() {
        let (db, _dir) = make_db();
        let data = b"binary data".to_vec();
        let result = db.optimize(&data, "application/octet-stream", "unknown.com");
        assert_eq!(result.data, data);
    }

    #[test]
    fn 통계가_누적된다() {
        let (db, _dir) = make_db();
        let jpeg = make_test_jpeg();
        db.optimize(&jpeg, "image/jpeg", "example.com");
        db.optimize(&jpeg, "image/jpeg", "example.com");
        let stats = db.get_all_stats().unwrap();
        let s = stats.iter().find(|s| s.domain == "example.com").unwrap();
        assert_eq!(s.count, 2);
        assert!(s.original_bytes > 0);
    }

    #[test]
    fn max_width_리사이즈가_동작한다() {
        let (db, _dir) = make_db();
        db.set_profile("example.com", 85, 5, true).unwrap(); // max_width=5px
        let jpeg = make_test_jpeg(); // 10x10
        let result = db.optimize(&jpeg, "image/jpeg", "example.com");
        assert_eq!(result.content_type, "image/webp");
    }

    // ── 테스트용 이미지 생성 헬퍼 ─────────────────────────────────

    fn make_test_jpeg() -> Vec<u8> {
        let img = image::DynamicImage::new_rgb8(10, 10);
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg).unwrap();
        buf
    }

    fn make_test_png() -> Vec<u8> {
        let img = image::DynamicImage::new_rgba8(10, 10);
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).unwrap();
        buf
    }
}
