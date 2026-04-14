use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use bytes::Bytes;
use axum::http::StatusCode;
use tokio::sync::broadcast;

/// broadcast 채널 용량 — 동시 구독자가 이 수를 초과하면 Lagged 에러 발생
/// CDN 캐시 미스 버스트 시나리오를 고려하여 256으로 설정
const COALESCE_CHANNEL_CAPACITY: usize = 256;

/// origin fetch 결과 — (body, content_type, status)
pub type CoalescedResponse = Arc<(Bytes, Option<String>, StatusCode)>;

/// in-flight 요청 맵 — cache key → broadcast sender
/// 첫 번째 miss 요청이 Sender를 삽입하고 fetch 완료 후 결과를 broadcast
pub struct Coalescer {
    in_flight: Mutex<HashMap<String, broadcast::Sender<Result<CoalescedResponse, ()>>>>,
}

impl Coalescer {
    pub fn new() -> Self {
        Self { in_flight: Mutex::new(HashMap::new()) }
    }

    /// cache miss 발생 시 호출.
    /// - in_flight에 key 없음 → 첫 번째 요청자: fetch_fn 실행 후 결과 broadcast
    /// - in_flight에 key 있음 → 구독자: 첫 번째 결과를 rx.recv()로 수신
    pub async fn get_or_fetch<F, Fut>(
        &self,
        key: String,
        fetch_fn: F,
    ) -> Result<CoalescedResponse, ()>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<CoalescedResponse, ()>>,
    {
        // in_flight 맵에서 기존 sender 조회, 없으면 신규 채널 생성
        // std::sync::Mutex 사용: .await 없이 짧은 임계 구간만 잠금
        let maybe_rx = {
            let mut map = self.in_flight.lock().unwrap();
            if let Some(sender) = map.get(&key) {
                // 이미 in-flight — 구독자로 등록
                Some(sender.subscribe())
            } else {
                // 첫 번째 miss — broadcast 채널 삽입
                let (tx, _) = broadcast::channel(COALESCE_CHANNEL_CAPACITY);
                map.insert(key.clone(), tx);
                None
            }
        };

        if let Some(mut rx) = maybe_rx {
            // 구독자: 첫 번째 요청 완료 대기
            match rx.recv().await {
                Ok(result) => result,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(key=%key, skipped=%n, "coalescer broadcast lagged — 502 반환");
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
                Ok(Arc::new((Bytes::from("other"), None, StatusCode::OK)))
            })
            .await
        });

        let (res_a, res_b) = tokio::join!(task_a, task_b);
        let res_a = res_a.unwrap().unwrap();
        let res_b = res_b.unwrap().unwrap();

        assert_eq!(call_count.load(Ordering::SeqCst), 1, "fetch_fn이 한 번만 호출되어야 한다");
        assert_eq!(res_a.0, res_b.0, "두 응답 body가 동일해야 한다");
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
