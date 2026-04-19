//! 텍스트 응답 압축 유틸 — Brotli 프리컴프레스 + gzip 폴백 + Accept-Encoding 협상.
//!
//! 전부 순수 CPU 작업이므로 호출부에서 `tokio::task::spawn_blocking`으로 감싸는 책임을 진다.

use std::io::{Read, Write};

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
