/// Optimizer 핵심 로직
/// - SQLite: 도메인별 프로파일 + 절감 통계
/// - optimize(): 포맷 보존 재인코딩 + 리사이즈 + size-guard (Phase 14)
use rusqlite::{Connection, params};
use std::sync::Mutex;

use crate::encoder;

/// Phase 14: 포맷 보존 재인코딩 결과 분류 — grpc.rs가 OptimizeResponse.decision 문자열로 매핑.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptimizeDecision {
    /// 재인코딩 성공 + out < orig
    Optimized,
    /// 재인코딩 성공 but out >= orig → 원본 유지 (캐시 공간 보호)
    PassthroughLarger,
    /// decode/encode 실패 → 원본 유지 (서비스 연속성)
    PassthroughError,
    /// 디코드 불가 content_type 또는 animated GIF → 원본 유지
    PassthroughUnsupported,
}

impl OptimizeDecision {
    /// proto decision 문자열 매핑 (optimization_events.decision 컬럼 값)
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Optimized              => "optimized",
            Self::PassthroughLarger      => "passthrough_larger",
            Self::PassthroughError       => "passthrough_error",
            Self::PassthroughUnsupported => "passthrough_unsupported",
        }
    }
}

/// 최적화 결과
pub struct OptimizeResult {
    pub data:           Vec<u8>,
    pub content_type:   String,
    pub original_size:  i64,
    pub optimized_size: i64,
    /// Phase 14: 최적화 결정 사유 — Some이면 observability 이벤트 대상.
    /// enabled=false 프로파일은 None (관찰 대상 아님).
    pub decision:       Option<OptimizeDecision>,
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
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
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
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT OR REPLACE INTO profiles (domain, quality, max_width, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![domain, quality, max_width, enabled as i32],
        )?;
        Ok(())
    }

    /// 모든 프로파일 목록 반환
    pub fn get_all_profiles(&self) -> Result<Vec<(String, Profile)>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
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
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
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
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let result = conn.execute(
            "INSERT INTO optimization_stats (domain, original_bytes, optimized_bytes, count)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(domain) DO UPDATE SET
               original_bytes  = original_bytes  + excluded.original_bytes,
               optimized_bytes = optimized_bytes + excluded.optimized_bytes,
               count           = count + 1,
               updated_at      = datetime('now')",
            params![domain, original_size, optimized_size],
        );
        if let Err(e) = result {
            tracing::warn!("통계 업데이트 실패: {}", e);
        }
    }

    /// 콘텐츠 최적화 — 포맷 보존 재인코딩 + size-guard (Phase 14).
    /// enabled=false → 원본 그대로, decision=None (이벤트 발행 대상 X).
    pub fn optimize(&self, data: &[u8], content_type: &str, domain: &str) -> OptimizeResult {
        let original_size = data.len() as i64;
        let profile = self.get_profile(domain);

        if !profile.enabled {
            return OptimizeResult {
                data:           data.to_vec(),
                content_type:   content_type.to_string(),
                original_size,
                optimized_size: original_size,
                decision:       None,
            };
        }

        let outcome = optimize_preserving_format(data, content_type, &profile);
        let optimized_size = outcome.bytes.len() as i64;
        self.update_stats(domain, original_size, optimized_size);

        OptimizeResult {
            data:           outcome.bytes,
            content_type:   outcome.content_type,
            original_size,
            optimized_size,
            decision:       Some(outcome.decision),
        }
    }
}

/// Phase 14: 포맷 보존 재인코딩 결과.
/// bytes는 항상 반환(passthrough 시에도 원본 바이트 포함)하여 호출자 단순화.
pub struct FormatPreservingOutcome {
    pub bytes:        Vec<u8>,
    pub content_type: String,
    pub decision:     OptimizeDecision,
}

/// content_type별 디코더/인코더 디스패치 + 리사이즈 + size-guard.
/// 실패·미지원·size-guard 케이스 전부 (원본 바이트 + content_type + decision)으로 통일 반환.
pub fn optimize_preserving_format(
    data: &[u8],
    content_type: &str,
    profile: &Profile,
) -> FormatPreservingOutcome {
    // `image/jpeg; charset=utf-8` 같은 파라미터 제거
    let ct_main = content_type.split(';').next().unwrap_or("").trim();

    // 디코드 가능 판정 — 미지원이면 조기 반환
    if !is_decodable(ct_main) {
        return passthrough(data, content_type, OptimizeDecision::PassthroughUnsupported);
    }

    // animated GIF 선제 검사 — prime frame 이상 존재 시 passthrough
    if ct_main == "image/gif" && is_animated_gif(data) {
        return passthrough(data, content_type, OptimizeDecision::PassthroughUnsupported);
    }

    // 디코드
    let mut img = match image::load_from_memory(data) {
        Ok(i)  => i,
        Err(_) => return passthrough(data, content_type, OptimizeDecision::PassthroughError),
    };

    // 리사이즈 (max_width 설정되어 있고 원본이 그보다 크면)
    if profile.max_width > 0 && img.width() > profile.max_width {
        img = img.resize(profile.max_width, u32::MAX, image::imageops::FilterType::Lanczos3);
    }

    // 포맷별 인코더 디스패치
    let (encoded, out_ct) = match ct_main {
        "image/jpeg" => match encoder::encode_jpeg(&img, profile.quality as u8) {
            Ok(b)  => (b, "image/jpeg"),
            Err(_) => return passthrough(data, content_type, OptimizeDecision::PassthroughError),
        },
        "image/png" => match encoder::encode_png(&img) {
            Ok(b)  => (b, "image/png"),
            Err(_) => return passthrough(data, content_type, OptimizeDecision::PassthroughError),
        },
        "image/webp" => match encoder::encode_webp_lossy(&img, profile.quality as u8) {
            Ok(b)  => (b, "image/webp"),
            Err(_) => return passthrough(data, content_type, OptimizeDecision::PassthroughError),
        },
        "image/gif" | "image/bmp" | "image/tiff" => match encoder::encode_webp_lossless(&img) {
            Ok(b)  => (b, "image/webp"),
            Err(_) => return passthrough(data, content_type, OptimizeDecision::PassthroughError),
        },
        _ => unreachable!("is_decodable()가 이미 허용했으므로 도달 불가"),
    };

    // size-guard — 원본 이상이면 원본 유지
    if encoded.len() >= data.len() {
        return passthrough(data, content_type, OptimizeDecision::PassthroughLarger);
    }

    FormatPreservingOutcome {
        bytes:        encoded,
        content_type: out_ct.to_string(),
        decision:     OptimizeDecision::Optimized,
    }
}

/// optimizer-service가 디코드+재인코딩 가능한 content_type 화이트리스트.
fn is_decodable(ct: &str) -> bool {
    matches!(ct,
        "image/jpeg" | "image/png" | "image/webp"
        | "image/gif" | "image/bmp" | "image/tiff"
    )
}

/// GIF 데이터에서 2번째 프레임 존재 여부로 애니메이션 판별.
/// 디코더 자체가 실패하면 false 반환(→ 이후 load_from_memory가 PassthroughError로 떨어짐).
fn is_animated_gif(data: &[u8]) -> bool {
    use image::AnimationDecoder;
    use image::codecs::gif::GifDecoder;
    let Ok(dec) = GifDecoder::new(std::io::Cursor::new(data)) else { return false; };
    let mut it = dec.into_frames().take(2);
    it.next();                   // 1st frame (소비)
    it.next().is_some()          // 2nd frame 존재 여부
}

fn passthrough(data: &[u8], content_type: &str, decision: OptimizeDecision) -> FormatPreservingOutcome {
    FormatPreservingOutcome {
        bytes:        data.to_vec(),
        content_type: content_type.to_string(),
        decision,
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
        assert!(result.decision.is_none(), "disabled → decision=None");
    }

    #[test]
    fn jpeg_입력은_jpeg로_유지된다() {
        let (db, _dir) = make_db();
        let jpeg = make_test_jpeg();
        let result = db.optimize(&jpeg, "image/jpeg", "unknown.com");
        assert_eq!(result.content_type, "image/jpeg");
        assert!(result.decision.is_some());
    }

    #[test]
    fn png_입력은_png로_유지된다() {
        let (db, _dir) = make_db();
        let png = make_test_png();
        let result = db.optimize(&png, "image/png", "unknown.com");
        assert_eq!(result.content_type, "image/png");
        assert!(result.decision.is_some());
    }

    #[test]
    fn webp_입력은_재인코딩된다() {
        let (db, _dir) = make_db();
        let img = image::DynamicImage::new_rgb8(16, 16);
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::WebP).unwrap();
        let result = db.optimize(&buf, "image/webp", "unknown.com");
        assert_eq!(result.content_type, "image/webp");
        assert!(result.decision.is_some(), "enabled=true → decision=Some");
    }

    #[test]
    fn 알수없는_타입은_passthrough_unsupported() {
        let (db, _dir) = make_db();
        let data = b"binary data".to_vec();
        let result = db.optimize(&data, "application/octet-stream", "unknown.com");
        assert_eq!(result.data, data);
        assert_eq!(result.decision, Some(OptimizeDecision::PassthroughUnsupported));
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
        assert_eq!(result.content_type, "image/jpeg");
    }

    #[test]
    fn bmp_입력은_webp로_변환된다() {
        let (db, _dir) = make_db();
        let bmp = {
            let img = image::DynamicImage::new_rgb8(32, 32);
            let mut buf = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Bmp).unwrap();
            buf
        };
        let result = db.optimize(&bmp, "image/bmp", "unknown.com");
        assert_eq!(result.content_type, "image/webp");
        assert_eq!(result.decision, Some(OptimizeDecision::Optimized));
    }

    #[test]
    fn tiff_입력은_webp로_변환된다() {
        let (db, _dir) = make_db();
        let tiff = {
            let img = image::DynamicImage::new_rgb8(32, 32);
            let mut buf = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Tiff).unwrap();
            buf
        };
        let result = db.optimize(&tiff, "image/tiff", "unknown.com");
        assert_eq!(result.content_type, "image/webp");
        assert_eq!(result.decision, Some(OptimizeDecision::Optimized));
    }

    #[test]
    fn gif_정지_입력은_decision_some() {
        let (db, _dir) = make_db();
        let gif = {
            let img = image::DynamicImage::new_rgb8(32, 32);
            let mut buf = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Gif).unwrap();
            buf
        };
        let result = db.optimize(&gif, "image/gif", "unknown.com");
        // 성공 경로면 image/webp, passthrough면 image/gif 유지
        assert!(result.content_type == "image/webp" || result.content_type == "image/gif");
        assert!(result.decision.is_some());
    }

    #[test]
    fn 손상된_이미지는_passthrough_error() {
        let (db, _dir) = make_db();
        let data = b"\xFF\xD8 corrupted jpeg".to_vec();
        let result = db.optimize(&data, "image/jpeg", "unknown.com");
        assert_eq!(result.data, data);
        assert_eq!(result.decision, Some(OptimizeDecision::PassthroughError));
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
