use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use bytes::Bytes;
use axum::http::StatusCode;
use tokio::sync::broadcast;

/// broadcast 채널 기본 용량 — 채널이 동시에 보관할 수 있는 미수신 메시지 최대 수.
/// 정확하게는 "구독자 수" 한도가 아니라 "동시 in-flight 메시지" 한도이며, 현재 fetcher 가 단일 send 만
/// 하므로 정상 흐름에서는 Lagged 가 발생하지 않는다. 다만 향후 multi-send 변경 또는 panic/재시도 경로가
/// 추가될 경우 capacity 가 영향을 주므로, 학교 1교시 일제 시작 같은 burst 시나리오 대응 마진으로
/// 256 → 1024 로 상향한다 (#390). 환경변수 PROXY_COALESCE_CHANNEL_CAPACITY 로 학교 규모에 맞춰 조정.
const DEFAULT_COALESCE_CHANNEL_CAPACITY: usize = 1024;

fn coalesce_channel_capacity() -> usize {
    std::env::var("PROXY_COALESCE_CHANNEL_CAPACITY")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_COALESCE_CHANNEL_CAPACITY)
}

use crate::CacheOutcome;

/// origin fetch 결과 — (body, content_type, status, outcome, cached_headers, passthrough_headers)
/// Phase 20: cached_headers 는 L1/L2 에 저장할 화이트리스트,
///            passthrough_headers 는 MISS 응답에만 붙이는 Location/Retry-After 등의 헤더.
pub type CoalescedResponse = Arc<(
    Bytes,
    Option<String>,
    StatusCode,
    CacheOutcome,
    Vec<(String, String)>,
    Vec<(String, String)>,
)>;

/// in-flight 요청 맵 — cache key → broadcast sender
/// 첫 번째 miss 요청이 Sender를 삽입하고 fetch 완료 후 결과를 broadcast
pub struct Coalescer {
    in_flight: Mutex<HashMap<String, broadcast::Sender<Result<CoalescedResponse, ()>>>>,
    capacity: usize,
    /// #390 — Lagged 발생 누계. 운영자가 stats 로 폭주 빈도를 관찰해 PROXY_COALESCE_CHANNEL_CAPACITY 상향 판단에 사용.
    lagged_count: AtomicU64,
}

impl Coalescer {
    pub fn new() -> Self {
        Self {
            in_flight: Mutex::new(HashMap::new()),
            capacity: coalesce_channel_capacity(),
            lagged_count: AtomicU64::new(0),
        }
    }

    /// 명시적 capacity 로 생성 — 테스트에서 작은 값으로 Lagged 시나리오 검증할 때 사용.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            in_flight: Mutex::new(HashMap::new()),
            capacity: capacity.max(1),
            lagged_count: AtomicU64::new(0),
        }
    }

    /// Lagged 누계 (관찰용)
    pub fn lagged_count(&self) -> u64 {
        self.lagged_count.load(Ordering::Relaxed)
    }

    /// 기본 capacity 로 fetch — 글로벌 정책만 적용되는 경로.
    pub async fn get_or_fetch<F, Fut>(
        &self,
        key: String,
        fetch_fn: F,
    ) -> Result<CoalescedResponse, ()>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<CoalescedResponse, ()>>,
    {
        self.get_or_fetch_with_capacity(key, self.capacity, fetch_fn).await
    }

    /// cache miss 발생 시 호출.
    /// - in_flight에 key 없음 → 첫 번째 요청자: fetch_fn 실행 후 결과 broadcast
    /// - in_flight에 key 있음 → 구독자: 첫 번째 결과를 rx.recv()로 수신
    ///
    /// 이슈 #426 — capacity 를 호출자가 명시할 수 있게 한다.
    /// 같은 키의 후속 구독자는 이미 생성된 채널의 capacity 를 재사용 (변경하지 않음).
    /// 첫 요청자가 만든 채널만 capacity 적용 — 같은 host 의 다른 URL 은 각자 채널이므로 결국 모든 첫 요청에 반영된다.
    pub async fn get_or_fetch_with_capacity<F, Fut>(
        &self,
        key: String,
        capacity: usize,
        fetch_fn: F,
    ) -> Result<CoalescedResponse, ()>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<CoalescedResponse, ()>>,
    {
        let cap = capacity.max(1);
        // in_flight 맵에서 기존 sender 조회, 없으면 신규 채널 생성
        // std::sync::Mutex 사용: .await 없이 짧은 임계 구간만 잠금
        let maybe_rx = {
            let mut map = self.in_flight.lock().unwrap();
            if let Some(sender) = map.get(&key) {
                // 이미 in-flight — 구독자로 등록
                Some(sender.subscribe())
            } else {
                // 첫 번째 miss — broadcast 채널 삽입 (호출자 지정 capacity #426)
                let (tx, _) = broadcast::channel(cap);
                map.insert(key.clone(), tx);
                None
            }
        };

        if let Some(mut rx) = maybe_rx {
            // 구독자: 첫 번째 요청 완료 대기
            match rx.recv().await {
                Ok(result) => result,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    // #390 — Lagged 누계 카운트. 빈도가 높으면 capacity 상향 판단 근거.
                    self.lagged_count.fetch_add(1, Ordering::Relaxed);
                    tracing::warn!(key=%key, skipped=%n, "coalescer broadcast lagged — 502 반환 (#390: capacity 상향 검토)");
                    Err(())
                }
                Err(_) => Err(()), // sender drop (panic 등) → 에러 전파
            }
        } else {
            // DropGuard — panic 시에도 in_flight 키를 제거하여 영구 잠금 방지
            struct DropGuard<'a> {
                map: &'a Mutex<HashMap<String, broadcast::Sender<Result<CoalescedResponse, ()>>>>,
                key: Option<String>,
            }
            impl Drop for DropGuard<'_> {
                fn drop(&mut self) {
                    if let Some(key) = self.key.take() {
                        if let Ok(mut map) = self.map.lock() {
                            map.remove(&key);
                        }
                    }
                }
            }

            // 패닉 안전: 첫 번째 요청자 경로에서 어떤 이유로든 종료되면 키를 제거
            let mut guard = DropGuard { map: &self.in_flight, key: Some(key.clone()) };

            // 첫 번째 요청자: origin fetch 실행
            let result = fetch_fn().await;

            // fetch 완료 — 원자적으로 키 제거 + broadcast (guard 먼저 해제)
            guard.key = None;
            {
                let mut map = self.in_flight.lock().unwrap();
                if let Some(tx) = map.remove(&key) {
                    let _ = tx.send(result.clone());
                }
            }

            result
        }
    }
}

impl Default for Coalescer {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::time::{sleep, Duration};

    #[tokio::test]
    async fn 동시_요청_두_개가_origin을_한_번만_호출한다() {
        let coalescer = Arc::new(Coalescer::new());
        let call_count = Arc::new(AtomicUsize::new(0));

        let c1 = coalescer.clone();
        let cnt1 = call_count.clone();
        let task_a: tokio::task::JoinHandle<Result<CoalescedResponse, ()>> = tokio::spawn(async move {
            c1.get_or_fetch("key".to_string(), || async move {
                cnt1.fetch_add(1, Ordering::SeqCst);
                sleep(Duration::from_millis(50)).await;
                Ok(Arc::new((
                    Bytes::from("hello"),
                    Some("text/plain".to_string()),
                    StatusCode::OK,
                    CacheOutcome::Miss,
                    vec![],
                    vec![],
                )))
            })
            .await
        });

        // task_b 가 task_a fetch 도중 도착하도록 약간 대기
        sleep(Duration::from_millis(10)).await;

        let c2 = coalescer.clone();
        let cnt2 = call_count.clone();
        let task_b: tokio::task::JoinHandle<Result<CoalescedResponse, ()>> = tokio::spawn(async move {
            c2.get_or_fetch("key".to_string(), || async move {
                // 이 함수는 호출되어선 안 됨
                cnt2.fetch_add(1, Ordering::SeqCst);
                Ok(Arc::new((
                    Bytes::from("other"),
                    None,
                    StatusCode::OK,
                    CacheOutcome::Miss,
                    vec![],
                    vec![],
                )))
            })
            .await
        });

        let (res_a, res_b) = tokio::join!(task_a, task_b);
        let res_a = res_a.unwrap().unwrap();
        let res_b = res_b.unwrap().unwrap();

        assert_eq!(call_count.load(Ordering::SeqCst), 1, "fetch_fn이 한 번만 호출되어야 한다");
        assert_eq!(res_a.0, res_b.0, "두 응답 body가 동일해야 한다");
    }

    // #390 — capacity tunability + lagged_count 관찰자 노출 검증.
    // 실 운영에서는 fetcher 가 단일 send 만 하므로 정상 흐름에서 Lagged 가 발생하지 않는다.
    // 하지만 향후 multi-send 변경(e.g. progress 이벤트) 또는 panic/재시도 경로 도입 시
    // capacity 가 영향을 주므로 env 로 조정 가능한 구조 + 누적 카운터 관찰자를 유지한다.
    #[tokio::test]
    async fn capacity_is_configurable_and_lagged_count_starts_at_zero() {
        let coalescer = Coalescer::with_capacity(2048);
        assert_eq!(coalescer.lagged_count(), 0);
        // 기본 capacity 와 다른 값으로 만들어졌는지는 직접 노출하지 않지만 broadcast 채널 동작 정상성으로 검증
        let arc = Arc::new(coalescer);
        let c = arc.clone();
        let r = c.get_or_fetch("k".to_string(), || async {
            Ok(Arc::new((
                Bytes::from("ok"), None, StatusCode::OK,
                CacheOutcome::Miss, vec![], vec![],
            )))
        }).await;
        assert!(r.is_ok());
        // 정상 흐름에서는 Lagged 발생 없음
        assert_eq!(arc.lagged_count(), 0);
    }

    // #426 — get_or_fetch_with_capacity 가 호출자 지정 capacity 로 채널을 만들고 결과를 정상 broadcast.
    #[tokio::test]
    async fn per_call_capacity_path_succeeds_and_broadcasts_result() {
        let coalescer = Arc::new(Coalescer::new());
        let call_count = Arc::new(AtomicUsize::new(0));

        let c1 = coalescer.clone();
        let cnt1 = call_count.clone();
        let task_a: tokio::task::JoinHandle<Result<CoalescedResponse, ()>> = tokio::spawn(async move {
            c1.get_or_fetch_with_capacity("k426".to_string(), 4096, || async move {
                cnt1.fetch_add(1, Ordering::SeqCst);
                sleep(Duration::from_millis(30)).await;
                Ok(Arc::new((
                    Bytes::from("v"), None, StatusCode::OK,
                    CacheOutcome::Miss, vec![], vec![],
                )))
            }).await
        });
        sleep(Duration::from_millis(5)).await;

        // 두 번째 구독자 — capacity 인자는 무시되고 첫 채널 결과를 그대로 받는다
        let c2 = coalescer.clone();
        let cnt2 = call_count.clone();
        let task_b: tokio::task::JoinHandle<Result<CoalescedResponse, ()>> = tokio::spawn(async move {
            c2.get_or_fetch_with_capacity("k426".to_string(), 1, || async move {
                cnt2.fetch_add(1, Ordering::SeqCst); // 호출되어선 안 됨
                Err(())
            }).await
        });

        let (a, b) = tokio::join!(task_a, task_b);
        assert!(a.unwrap().is_ok());
        assert!(b.unwrap().is_ok());
        assert_eq!(call_count.load(Ordering::SeqCst), 1);
    }

    // #426 — capacity=0 도 1 로 클램프되어 panic 없이 동작 (broadcast::channel 은 0 일 때 panic).
    #[tokio::test]
    async fn per_call_capacity_zero_is_clamped_to_one() {
        let coalescer = Arc::new(Coalescer::new());
        let r = coalescer.get_or_fetch_with_capacity("k".to_string(), 0, || async {
            Ok(Arc::new((
                Bytes::from("v"), None, StatusCode::OK,
                CacheOutcome::Miss, vec![], vec![],
            )))
        }).await;
        assert!(r.is_ok());
    }

    #[tokio::test]
    async fn fetch_실패_시_모든_대기_요청이_에러를_받는다() {
        let coalescer = Arc::new(Coalescer::new());

        let c1 = coalescer.clone();
        let task_a: tokio::task::JoinHandle<Result<CoalescedResponse, ()>> = tokio::spawn(async move {
            c1.get_or_fetch("key".to_string(), || async move {
                sleep(Duration::from_millis(30)).await;
                Err::<CoalescedResponse, ()>(())
            })
            .await
        });

        sleep(Duration::from_millis(5)).await;

        let c2 = coalescer.clone();
        let task_b: tokio::task::JoinHandle<Result<CoalescedResponse, ()>> = tokio::spawn(async move {
            c2.get_or_fetch("key".to_string(), || async move {
                Err::<CoalescedResponse, ()>(())
            })
            .await
        });

        let (res_a, res_b) = tokio::join!(task_a, task_b);
        assert!(res_a.unwrap().is_err(), "첫 번째 요청도 Err이어야 한다");
        assert!(res_b.unwrap().is_err(), "구독자도 Err이어야 한다");
    }
}
