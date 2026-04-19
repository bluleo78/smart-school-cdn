//! HTTP Range 요청 파서 + 실제 바이트 범위 해석.
//!
//! Phase 13 범위:
//!  - 단일 `bytes=START-END` / `bytes=START-` / `bytes=-SUFFIX` 세 가지 형식만 지원
//!  - Multi-range (`bytes=0-99,200-299`)는 **미지원** — 파싱 자체를 실패시키고 호출자가 200 fallback
//!  - 비표준 단위(`pages=`, `rows=` 등)는 당연히 미지원
//!
//! 파서는 순수 함수로 유지해 단위 테스트만으로 커버한다. 응답 생성/상태 코드 결정은
//! 호출자(proxy 핸들러)의 책임.

/// 파싱 성공 시의 Range 표현.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteRange {
    /// `bytes=START-END` — 양끝 포함
    Bounded { start: u64, end: u64 },
    /// `bytes=START-` — start부터 끝까지
    OpenEnd { start: u64 },
    /// `bytes=-LEN` — 마지막 LEN 바이트
    Suffix { length: u64 },
}

/// Range 헤더 값을 파싱.
/// 단일 범위만 허용하며, 형식이 어긋나거나 multi-range면 `None` 반환 → 호출자가 전체(200) fallback.
pub fn parse_byte_range(header: &str) -> Option<ByteRange> {
    // 전체 헤더 값의 외곽 공백만 허용 (HTTP line folding 잔재 보호)
    let trimmed = header.trim();
    // "bytes=" 접두사 필수 — 내부 공백은 이 시점 이후에 허용하지 않는다
    let spec = trimmed.strip_prefix("bytes=")?;
    // 다중 범위는 미지원 — 콤마 포함이면 reject
    if spec.contains(',') {
        return None;
    }
    // 하이픈 기준 split — 반드시 1개
    let (first, second) = spec.split_once('-')?;

    match (first.is_empty(), second.is_empty()) {
        // "bytes=-LEN"  : suffix
        (true, false) => {
            let length = parse_u64_strict(second)?;
            // 0-length suffix는 의미가 없으므로 reject
            if length == 0 { return None; }
            Some(ByteRange::Suffix { length })
        }
        // "bytes=START-"  : open-end
        (false, true) => {
            let start = parse_u64_strict(first)?;
            Some(ByteRange::OpenEnd { start })
        }
        // "bytes=START-END": bounded
        (false, false) => {
            let start = parse_u64_strict(first)?;
            let end   = parse_u64_strict(second)?;
            // 역방향 범위(end < start)는 invalid
            if end < start { return None; }
            Some(ByteRange::Bounded { start, end })
        }
        // "bytes=-" 은 어느 쪽도 아니므로 invalid
        (true, true) => None,
    }
}

/// 엄격한 u64 파싱 — 음수·공백·비숫자는 전부 거절.
fn parse_u64_strict(s: &str) -> Option<u64> {
    if s.is_empty() { return None; }
    if !s.bytes().all(|b| b.is_ascii_digit()) { return None; }
    s.parse::<u64>().ok()
}

/// total_size 기준으로 실제 응답할 바이트 범위 `(start, end_inclusive)` 계산.
/// - 시작이 total_size 이상이면 `None` → 호출자가 **416 Range Not Satisfiable**
/// - 끝이 total_size-1을 넘으면 total_size-1로 클램프 (RFC 7233 §2.1)
/// - `total_size == 0`이면 어떤 범위든 만족 불가 → `None`
pub fn resolve_range(range: ByteRange, total_size: u64) -> Option<(u64, u64)> {
    if total_size == 0 {
        return None;
    }
    let last = total_size - 1;
    match range {
        ByteRange::Bounded { start, end } => {
            if start > last { return None; }
            Some((start, end.min(last)))
        }
        ByteRange::OpenEnd { start } => {
            if start > last { return None; }
            Some((start, last))
        }
        ByteRange::Suffix { length } => {
            // 마지막 `length` 바이트 — total_size보다 크면 전체를 돌려준다
            let start = total_size.saturating_sub(length);
            Some((start, last))
        }
    }
}

/// 응답 `Content-Range` 헤더 값을 포맷한다: `bytes START-END/TOTAL`.
pub fn format_content_range(start: u64, end: u64, total: u64) -> String {
    format!("bytes {start}-{end}/{total}")
}

/// 416 응답용 `Content-Range` 헤더 값 — 알려지지 않은 범위 / 만족 불가: `bytes */TOTAL`.
pub fn format_content_range_unsatisfied(total: u64) -> String {
    format!("bytes */{total}")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── parse_byte_range ─────────────────────────────────────────
    #[test]
    fn parse_bounded() {
        assert_eq!(
            parse_byte_range("bytes=0-1023"),
            Some(ByteRange::Bounded { start: 0, end: 1023 })
        );
        assert_eq!(
            parse_byte_range("bytes=500-999"),
            Some(ByteRange::Bounded { start: 500, end: 999 })
        );
    }

    #[test]
    fn parse_open_end() {
        assert_eq!(
            parse_byte_range("bytes=100-"),
            Some(ByteRange::OpenEnd { start: 100 })
        );
    }

    #[test]
    fn parse_suffix() {
        assert_eq!(
            parse_byte_range("bytes=-500"),
            Some(ByteRange::Suffix { length: 500 })
        );
    }

    #[test]
    fn parse_tolerates_whitespace() {
        // RFC는 spec 주변 공백을 허용 — 일부 클라이언트가 붙여서 보냄
        assert_eq!(
            parse_byte_range("  bytes=0-9  "),
            Some(ByteRange::Bounded { start: 0, end: 9 })
        );
    }

    #[test]
    fn parse_rejects_multirange() {
        // multi-range는 미지원 → None 반환 (호출자가 200 fallback)
        assert!(parse_byte_range("bytes=0-99,200-299").is_none());
    }

    #[test]
    fn parse_rejects_unknown_unit_or_missing_prefix() {
        assert!(parse_byte_range("pages=1-2").is_none());
        assert!(parse_byte_range("0-100").is_none());
        assert!(parse_byte_range("").is_none());
    }

    #[test]
    fn parse_rejects_empty_both_sides() {
        assert!(parse_byte_range("bytes=-").is_none());
    }

    #[test]
    fn parse_rejects_reverse_range() {
        // end < start는 invalid
        assert!(parse_byte_range("bytes=100-50").is_none());
    }

    #[test]
    fn parse_rejects_non_numeric() {
        assert!(parse_byte_range("bytes=abc-123").is_none());
        assert!(parse_byte_range("bytes=12-x").is_none());
        assert!(parse_byte_range("bytes= 12-34").is_none()); // 내부 공백(엄격 모드)
        // 음수 표기(minus)는 하이픈 때문에 자동 분리되지만 별도 형식이라 reject 되어야 함
        assert!(parse_byte_range("bytes=--5").is_none());
    }

    #[test]
    fn parse_rejects_zero_suffix() {
        assert!(parse_byte_range("bytes=-0").is_none());
    }

    // ─── resolve_range ────────────────────────────────────────────
    #[test]
    fn resolve_bounded_within_total() {
        assert_eq!(
            resolve_range(ByteRange::Bounded { start: 0, end: 9 }, 100),
            Some((0, 9))
        );
        assert_eq!(
            resolve_range(ByteRange::Bounded { start: 50, end: 99 }, 100),
            Some((50, 99))
        );
    }

    #[test]
    fn resolve_bounded_end_clamps_to_last() {
        // end가 total을 넘으면 total-1로 클램프
        assert_eq!(
            resolve_range(ByteRange::Bounded { start: 90, end: 999 }, 100),
            Some((90, 99))
        );
    }

    #[test]
    fn resolve_bounded_start_beyond_total_returns_none() {
        // start가 total_size 이상이면 만족 불가 → 416
        assert_eq!(
            resolve_range(ByteRange::Bounded { start: 100, end: 199 }, 100),
            None
        );
        assert_eq!(
            resolve_range(ByteRange::Bounded { start: 200, end: 299 }, 100),
            None
        );
    }

    #[test]
    fn resolve_open_end_returns_last() {
        assert_eq!(
            resolve_range(ByteRange::OpenEnd { start: 10 }, 100),
            Some((10, 99))
        );
    }

    #[test]
    fn resolve_open_end_beyond_total_returns_none() {
        assert_eq!(resolve_range(ByteRange::OpenEnd { start: 100 }, 100), None);
    }

    #[test]
    fn resolve_suffix_returns_last_len_bytes() {
        assert_eq!(
            resolve_range(ByteRange::Suffix { length: 10 }, 100),
            Some((90, 99))
        );
    }

    #[test]
    fn resolve_suffix_longer_than_total_returns_full() {
        // 마지막 200바이트 요청이지만 전체가 100 → 전체 반환
        assert_eq!(
            resolve_range(ByteRange::Suffix { length: 200 }, 100),
            Some((0, 99))
        );
    }

    #[test]
    fn resolve_zero_total_is_none() {
        // 빈 바디는 어떤 Range도 만족 불가
        assert_eq!(
            resolve_range(ByteRange::Bounded { start: 0, end: 0 }, 0),
            None
        );
        assert_eq!(resolve_range(ByteRange::OpenEnd { start: 0 }, 0), None);
        assert_eq!(resolve_range(ByteRange::Suffix { length: 5 }, 0), None);
    }

    // ─── Content-Range 포맷 ───────────────────────────────────────
    #[test]
    fn format_content_range_basic() {
        assert_eq!(format_content_range(0, 99, 1000), "bytes 0-99/1000");
    }

    #[test]
    fn format_content_range_unsatisfied_basic() {
        assert_eq!(format_content_range_unsatisfied(1000), "bytes */1000");
    }
}
