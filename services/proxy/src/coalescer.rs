use std::collections::HashMap;
use std::sync::Arc;
use bytes::Bytes;
use axum::http::StatusCode;
use tokio::sync::{Mutex, broadcast};

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
        let maybe_rx = {
            let mut map = self.in_flight.lock().await;
            if let Some(sender) = map.get(&key) {
                // 이미 in-flight — 구독자로 등록
                Some(sender.subscribe())
            } else {
                // 첫 번째 miss — broadcast 채널 삽입 (capacity=16으로 lagged 방지)
                let (tx, _) = broadcast::channel(16);
                map.insert(key.clone(), tx);
                None
            }
        };

        if let Some(mut rx) = maybe_rx {
            // 구독자: 첫 번째 요청 완료 대기
            match rx.recv().await {
                Ok(result) => result,
                Err(_) => Err(()), // sender drop (panic 등) → 에러 전파
            }
        } else {
            // 첫 번째 요청자: origin fetch 실행
            let result = fetch_fn().await;

            // in_flight 제거 후 broadcast
            let sender = {
                let mut map = self.in_flight.lock().await;
                map.remove(&key)
            };
            if let Some(tx) = sender {
                let _ = tx.send(result.clone());
            }

            result
        }
    }
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
