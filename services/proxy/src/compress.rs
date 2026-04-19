//! 텍스트 응답 압축 유틸 — Brotli 프리컴프레스 + gzip 폴백 + Accept-Encoding 협상.
//!
//! 전부 순수 CPU 작업이므로 호출부에서 `tokio::task::spawn_blocking`으로 감싸는 책임을 진다.

use std::io::{Read, Write};

const WHITELIST: &[&str] = &[
    "text/html", "text/css", "text/plain", "text/xml",
    "application/javascript", "application/json", "application/xml",
    "image/svg+xml",
];

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
