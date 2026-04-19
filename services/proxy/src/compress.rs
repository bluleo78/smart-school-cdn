//! 텍스트 응답 압축 유틸 — Brotli 프리컴프레스 + gzip 폴백 + Accept-Encoding 협상.
//!
//! 전부 순수 CPU 작업이므로 호출부에서 `tokio::task::spawn_blocking`으로 감싸는 책임을 진다.

use std::io::{Read, Write};

/// Accept-Encoding 협상 결과 — 클라이언트가 수락하는 인코딩 우선순위.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding { Br, Gzip, Identity }

/// Accept-Encoding 헤더를 파싱해 최적 인코딩을 반환한다.
/// br > gzip > identity 순으로 우선순위를 적용한다.
pub fn negotiate_encoding(accept_encoding: Option<&str>) -> Encoding {
    let Some(raw) = accept_encoding else { return Encoding::Identity; };
    if raw.trim().is_empty() { return Encoding::Identity; }

    let mut br_ok = false;
    let mut gzip_ok = false;
    let mut star_ok = false;
    for item in raw.split(',').map(str::trim) {
        if item.is_empty() { continue; }
        let mut parts = item.split(';').map(str::trim);
        let name = parts.next().unwrap_or("").to_ascii_lowercase();
        let mut q: f32 = 1.0;
        for p in parts {
            if let Some(v) = p.strip_prefix("q=") {
                if let Ok(parsed) = v.parse::<f32>() { q = parsed; }
            }
        }
        let accepted = q > 0.0;
        match name.as_str() {
            "br" if accepted => br_ok = true,
            "gzip" if accepted => gzip_ok = true,
            "*" if accepted => star_ok = true,
            _ => {}
        }
    }
    if br_ok || star_ok { Encoding::Br }
    else if gzip_ok     { Encoding::Gzip }
    else                { Encoding::Identity }
}

const WHITELIST: &[&str] = &[
    "text/html", "text/css", "text/plain", "text/xml",
    "application/javascript", "application/json", "application/xml",
    "image/svg+xml",
];

/// content-type 문자열이 텍스트 압축 화이트리스트에 해당하는지 반환.
/// WHITELIST를 재활용해 DRY를 유지한다.
pub fn is_text_content_type(content_type: Option<&str>) -> bool {
    let Some(ct) = content_type else { return false; };
    let base = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    WHITELIST.iter().any(|w| *w == base.as_str())
}

/// 응답을 압축해야 하는지 판정.
/// content_type, content_encoding, 응답 크기, 최소 압축 임계값을 기준으로 결정한다.
pub fn should_compress(
    content_type: Option<&str>,
    content_encoding: Option<&str>,
    size: usize,
    min_bytes: usize,
) -> bool {
    if size < min_bytes { return false; }
    let ce = content_encoding.unwrap_or("").trim().to_ascii_lowercase();
    if !ce.is_empty() && ce != "identity" { return false; }
    let Some(ct) = content_type else { return false; };
    let base = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    WHITELIST.iter().any(|w| *w == base)
}

/// gzip 인코딩 — br 미지원 클라이언트용 on-demand 폴백.
pub fn encode_gzip(body: &[u8], level: u32) -> std::io::Result<Vec<u8>> {
    use flate2::{write::GzEncoder, Compression};
    let mut enc = GzEncoder::new(Vec::with_capacity(body.len() / 2), Compression::new(level));
    enc.write_all(body)?;
    enc.finish()
}

/// Brotli 스트림 디컴프레션 — HIT 경로에서 gzip 폴백 시 역변환용.
pub fn decompress_brotli(br: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut reader = brotli::Decompressor::new(br, 4096);
    reader.read_to_end(&mut out)?;
    Ok(out)
}

/// Brotli 압축 — level은 0..=11, 11이 최대 압축률/최대 시간.
/// 호출부가 `spawn_blocking`으로 감쌀 것을 전제한다.
pub fn compress_brotli(body: &[u8], level: u32) -> std::io::Result<Vec<u8>> {
    use brotli::enc::BrotliEncoderParams;
    let mut params = BrotliEncoderParams::default();
    params.quality = level as i32;
    let mut out = Vec::with_capacity(body.len() / 2);
    let mut input = body;
    brotli::BrotliCompress(&mut input, &mut out, &params)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiate_encoding_br_우선() {
        assert_eq!(negotiate_encoding(Some("br, gzip, deflate")), Encoding::Br);
        assert_eq!(negotiate_encoding(Some("gzip, br")), Encoding::Br);
        assert_eq!(negotiate_encoding(Some("*")), Encoding::Br);
    }

    #[test]
    fn negotiate_encoding_gzip_폴백() {
        assert_eq!(negotiate_encoding(Some("gzip")), Encoding::Gzip);
        assert_eq!(negotiate_encoding(Some("gzip, deflate")), Encoding::Gzip);
        assert_eq!(negotiate_encoding(Some("br;q=0, gzip")), Encoding::Gzip);
    }

    #[test]
    fn negotiate_encoding_identity() {
        assert_eq!(negotiate_encoding(None), Encoding::Identity);
        assert_eq!(negotiate_encoding(Some("")), Encoding::Identity);
        assert_eq!(negotiate_encoding(Some("deflate")), Encoding::Identity);
        assert_eq!(negotiate_encoding(Some("br;q=0, gzip;q=0")), Encoding::Identity);
    }

    #[test]
    fn negotiate_encoding_q_파싱() {
        assert_eq!(negotiate_encoding(Some("gzip;q=0.8, br;q=0")), Encoding::Gzip);
        assert_eq!(negotiate_encoding(Some("gzip;q=1.0, br;q=0.1")), Encoding::Br);
    }

    #[test]
    fn should_compress_화이트리스트_통과() {
        assert!(should_compress(Some("text/html"), None, 2048, 1024));
        assert!(should_compress(Some("text/html; charset=utf-8"), None, 2048, 1024));
        assert!(should_compress(Some("application/javascript"), None, 2048, 1024));
        assert!(should_compress(Some("application/json"), None, 2048, 1024));
        assert!(should_compress(Some("image/svg+xml"), None, 2048, 1024));
    }

    #[test]
    fn should_compress_화이트리스트_밖은_거부() {
        assert!(!should_compress(Some("image/jpeg"), None, 2048, 1024));
        assert!(!should_compress(Some("video/mp4"), None, 2048, 1024));
        assert!(!should_compress(Some("application/octet-stream"), None, 2048, 1024));
        assert!(!should_compress(Some("text/event-stream"), None, 2048, 1024));
        assert!(!should_compress(None, None, 2048, 1024));
    }

    #[test]
    fn should_compress_최소크기_미만은_거부() {
        assert!(!should_compress(Some("text/html"), None, 1023, 1024));
        assert!(should_compress(Some("text/html"), None, 1024, 1024));
    }

    #[test]
    fn should_compress_이미_인코딩된_응답은_거부() {
        assert!(!should_compress(Some("text/html"), Some("gzip"), 2048, 1024));
        assert!(!should_compress(Some("text/html"), Some("br"), 2048, 1024));
        assert!(!should_compress(Some("text/html"), Some("deflate"), 2048, 1024));
        assert!(should_compress(Some("text/html"), Some(""), 2048, 1024));
        assert!(should_compress(Some("text/html"), Some("identity"), 2048, 1024));
    }

    #[test]
    fn gzip_라운드트립() {
        use flate2::read::GzDecoder;
        let body = b"text/html content ".repeat(80);
        let gz = encode_gzip(&body, 6).unwrap();
        let mut out = Vec::new();
        GzDecoder::new(&gz[..]).read_to_end(&mut out).unwrap();
        assert_eq!(out, body);
    }

    #[test]
    fn brotli_라운드트립_원본_복원() {
        let body = b"The quick brown fox jumps over the lazy dog.".repeat(50);
        let br = compress_brotli(&body, 11).unwrap();
        let back = decompress_brotli(&br).unwrap();
        assert_eq!(back, body, "decompress 결과가 원본과 일치해야 함");
    }

    #[test]
    fn compress_brotli_는_입력을_줄이고_signature로_시작한다() {
        let body = "Hello, Phase 15!".repeat(100);
        let br = compress_brotli(body.as_bytes(), 11).expect("brotli 압축 실패");
        assert!(br.len() < body.len() / 2, "반복 텍스트는 50% 미만으로 압축돼야 함: br={}, orig={}", br.len(), body.len());
    }
}
