//! 포맷별 순수 인코더 함수 — 디코드된 DynamicImage를 받아 바이트 버퍼로 반환.
//!
//! Phase 14:
//!  - JPEG: image 크레이트 JpegEncoder::new_with_quality  ← 이번 Task
//!  - PNG : image 크레이트 PNG 인코더 + oxipng lossless 재압축   (Task 4)
//!  - WebP lossy   : webp 크레이트(libwebp 래퍼) Encoder.encode(quality) (Task 5)
//!  - WebP lossless: webp 크레이트 Encoder.encode_lossless()             (Task 6)
//!
//! 순수 함수만 두어 단위 테스트로 완결하고, 리사이즈·프로파일 조회는 optimizer.rs가 담당한다.

use image::DynamicImage;

/// 인코더 실패 분류 — 호출자가 passthrough_error 결정에 사용.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeError {
    /// image/webp/oxipng 인코딩 단계에서 실패
    Encode,
}

/// JPEG 인코딩 — quality 1~100 (image 크레이트 convention).
/// 성공 시 JPEG 바이트 버퍼(Vec<u8>) 반환.
pub fn encode_jpeg(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, EncodeError> {
    use image::codecs::jpeg::JpegEncoder;
    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    img.write_with_encoder(encoder).map_err(|_| EncodeError::Encode)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::DynamicImage;

    fn sample_rgb(w: u32, h: u32) -> DynamicImage {
        DynamicImage::new_rgb8(w, h)
    }

    #[test]
    fn jpeg_85_인코딩이_유효한_출력을_낸다() {
        let img = sample_rgb(32, 32);
        let out = encode_jpeg(&img, 85).expect("encode 성공");
        // JPEG SOI 마커(0xFFD8)로 시작
        assert_eq!(&out[..2], b"\xFF\xD8");
    }

    #[test]
    fn jpeg_50_이_85보다_더_작다() {
        let img = DynamicImage::new_rgb8(64, 64);
        let q85 = encode_jpeg(&img, 85).unwrap();
        let q50 = encode_jpeg(&img, 50).unwrap();
        // 낮은 quality가 더 작은 출력 생성 (flat 이미지에선 동일 가능 → <=)
        assert!(q50.len() <= q85.len(), "q50({}) <= q85({})", q50.len(), q85.len());
    }

    #[test]
    fn jpeg_차원이_유지된다() {
        let img = sample_rgb(20, 15);
        let out = encode_jpeg(&img, 85).unwrap();
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!(decoded.width(),  20);
        assert_eq!(decoded.height(), 15);
    }
}
