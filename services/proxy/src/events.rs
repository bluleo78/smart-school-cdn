//! 최적화 이벤트 배치 push 모듈.
//!
//! 프록시 핸들러가 `EventsSender::emit(record)`으로 이벤트를 비블로킹으로 넘기면,
//! 백그라운드 태스크가 배치 크기에 도달하거나 일정 주기마다
//! admin-server `POST /internal/events/batch` 로 묶어서 보낸다.
//!
//! 전송 실패는 warn 로그만 남기고 버퍼를 비운다 — 관찰 인프라 실패가
//! 프록시 응답 경로를 절대 막지 않아야 한다.

use serde::Serialize;
use std::time::Duration;
use tokio::sync::mpsc;

/// 단일 이벤트 레코드 — admin-server `optimization_events` 스키마와 1:1 매칭.
/// `ts` 필드는 의도적으로 빼서 admin-server 쪽이 현재 시각으로 채우도록 한다
/// (프록시 노드와 admin-server 노드 시계 차이를 최소화).
#[derive(Debug, Clone, Serialize)]
pub struct EventRecord {
    /// "media_cache" | "image_optimize" | "text_compress"
    pub event_type: &'static str,
    pub host: String,
    pub url: String,
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orig_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub elapsed_ms: u64,
}

/// 기본 배치 크기 — 이 값을 넘으면 타이머 대기 없이 즉시 flush
const DEFAULT_BATCH_SIZE: usize = 200;
/// 기본 플러시 주기 — 배치가 안 채워져도 이 시간마다 비움
const DEFAULT_FLUSH_INTERVAL: Duration = Duration::from_secs(5);
/// mpsc 채널 용량 — 트래픽 폭주 시 여기 한계에서 try_send가 드롭
const DEFAULT_CHANNEL_CAPACITY: usize = 4096;
/// HTTP POST 타임아웃 — admin-server 지연이 proxy에 전파되지 않게 짧게 제한
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);

/// events push 태스크 구성값
#[derive(Clone, Debug)]
pub struct EventsConfig {
    /// admin-server 베이스 URL (예: `http://admin-server:4001`, 말미 `/` 없어도 됨)
    pub admin_url: String,
    pub batch_size: usize,
    pub flush_interval: Duration,
    pub channel_capacity: usize,
}

impl EventsConfig {
    /// 환경변수 `ADMIN_SERVER_URL`을 읽어 기본값으로 구성.
    /// 환경변수가 없으면 docker-compose 기본 서비스명으로 폴백한다.
    pub fn from_env() -> Self {
        let admin_url = std::env::var("ADMIN_SERVER_URL")
            .unwrap_or_else(|_| "http://admin-server:4001".to_string());
        Self {
            admin_url,
            batch_size: DEFAULT_BATCH_SIZE,
            flush_interval: DEFAULT_FLUSH_INTERVAL,
            channel_capacity: DEFAULT_CHANNEL_CAPACITY,
        }
    }
}

/// 프록시 핸들러가 사용하는 송신 핸들 — `Clone` 가능, 절대 블로킹하지 않음.
#[derive(Clone)]
pub struct EventsSender {
    tx: mpsc::Sender<EventRecord>,
}

impl EventsSender {
    /// 이벤트를 채널에 넣는다. 채널이 가득 찼거나 수신자가 닫혔으면 **드롭**하고
    /// trace 로그만 남긴다. 응답 경로를 막아선 안 되기 때문이다.
    pub fn emit(&self, ev: EventRecord) {
        if let Err(e) = self.tx.try_send(ev) {
            tracing::trace!(error = %e, "events 드롭 — 채널 포화 또는 종료");
        }
    }
}

/// spawn된 플러시 태스크 핸들.
/// 호출자가 drop하지 않도록 보관해야 태스크가 조기 종료되지 않는다.
pub struct EventsPusher {
    pub sender: EventsSender,
    pub handle: tokio::task::JoinHandle<()>,
}

/// events 태스크 시작 — 채널 생성 + 백그라운드 플러시 태스크 spawn.
/// 반환된 `EventsPusher.sender`를 `ProxyState.events`에 주입한다.
pub fn start(cfg: EventsConfig) -> EventsPusher {
    let (tx, rx) = mpsc::channel::<EventRecord>(cfg.channel_capacity);
    let http = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .expect("reqwest Client 생성 실패");
    let endpoint = format!("{}/internal/events/batch", cfg.admin_url.trim_end_matches('/'));
    let handle = tokio::spawn(flush_loop(rx, http, endpoint, cfg.batch_size, cfg.flush_interval));
    EventsPusher {
        sender: EventsSender { tx },
        handle,
    }
}

/// 배치 플러시 루프 — 수신 이벤트를 버퍼에 모으고, 크기/시간 조건 중 하나라도 충족되면 전송.
async fn flush_loop(
    mut rx: mpsc::Receiver<EventRecord>,
    http: reqwest::Client,
    endpoint: String,
    batch_size: usize,
    flush_interval: Duration,
) {
    let mut buffer: Vec<EventRecord> = Vec::with_capacity(batch_size);
    let mut ticker = tokio::time::interval(flush_interval);
    // 지연이 길어져도 tick이 폭증하지 않도록 skip
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            maybe_ev = rx.recv() => {
                match maybe_ev {
                    Some(ev) => {
                        buffer.push(ev);
                        if buffer.len() >= batch_size {
                            flush_once(&http, &endpoint, &mut buffer).await;
                        }
                    }
                    None => {
                        // 송신자 전부 drop — 남은 버퍼 비우고 종료
                        if !buffer.is_empty() {
                            flush_once(&http, &endpoint, &mut buffer).await;
                        }
                        break;
                    }
                }
            }
            _ = ticker.tick() => {
                if !buffer.is_empty() {
                    flush_once(&http, &endpoint, &mut buffer).await;
                }
            }
        }
    }
}

/// 한 번의 배치 전송 — 성공/실패 모두 버퍼를 비운다(재시도 없음).
async fn flush_once(http: &reqwest::Client, endpoint: &str, buffer: &mut Vec<EventRecord>) {
    let payload = serde_json::json!({ "events": &*buffer });
    match http.post(endpoint).json(&payload).send().await {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!(count = buffer.len(), "events 배치 전송 성공");
        }
        Ok(resp) => {
            tracing::warn!(status = %resp.status(), count = buffer.len(), "events 배치 전송 실패 (admin-server 응답)");
        }
        Err(e) => {
            tracing::warn!(error = %e, count = buffer.len(), "events 배치 전송 실패");
        }
    }
    buffer.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_record() -> EventRecord {
        EventRecord {
            event_type:   "media_cache",
            host:         "a.test".to_string(),
            url:          "https://a.test/x.mp4".to_string(),
            decision:     "served_206".to_string(),
            orig_size:    Some(1024),
            out_size:     Some(100),
            range_header: Some("bytes=0-99".to_string()),
            content_type: Some("video/mp4".to_string()),
            elapsed_ms:   4,
        }
    }

    #[test]
    fn config_from_env_defaults_include_admin_url() {
        // ADMIN_SERVER_URL 미설정 가정 — 기본 docker-compose 서비스명으로 폴백
        // (기존 환경에 이미 설정돼 있을 수 있어 prefix만 확인)
        let cfg = EventsConfig::from_env();
        assert!(
            cfg.admin_url.starts_with("http://") || cfg.admin_url.starts_with("https://"),
            "admin_url은 http(s):// 로 시작해야 한다: {}", cfg.admin_url
        );
        assert_eq!(cfg.batch_size, DEFAULT_BATCH_SIZE);
        assert_eq!(cfg.flush_interval, DEFAULT_FLUSH_INTERVAL);
        assert_eq!(cfg.channel_capacity, DEFAULT_CHANNEL_CAPACITY);
    }

    #[test]
    fn event_record_serializes_with_snake_case_fields() {
        let rec = sample_record();
        let json = serde_json::to_value(&rec).unwrap();
        // admin-server OptimizationEventInput 스키마와 필드명·형태 일치
        assert_eq!(json["event_type"], "media_cache");
        assert_eq!(json["host"], "a.test");
        assert_eq!(json["decision"], "served_206");
        assert_eq!(json["orig_size"], 1024);
        assert_eq!(json["out_size"], 100);
        assert_eq!(json["range_header"], "bytes=0-99");
        assert_eq!(json["content_type"], "video/mp4");
        assert_eq!(json["elapsed_ms"], 4);
        // ts는 포함하지 않는다 — admin-server가 채움
        assert!(json.get("ts").is_none());
    }

    #[test]
    fn event_record_omits_none_optional_fields() {
        let rec = EventRecord {
            event_type:   "media_cache",
            host:         "a.test".into(),
            url:          "https://a.test/y".into(),
            decision:     "bypass_nocache".into(),
            orig_size:    None,
            out_size:     None,
            range_header: None,
            content_type: None,
            elapsed_ms:   3,
        };
        let json = serde_json::to_value(&rec).unwrap();
        // skip_serializing_if 덕분에 None 필드는 직렬화에서 빠진다
        assert!(json.get("orig_size").is_none());
        assert!(json.get("out_size").is_none());
        assert!(json.get("range_header").is_none());
        assert!(json.get("content_type").is_none());
        // 필수 필드는 그대로 존재
        assert_eq!(json["decision"], "bypass_nocache");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn emit_drops_when_channel_full_without_panic() {
        // 용량 1로 만들고 수신자는 읽지 않음 → 두 번째 send는 무조건 꽉 참
        let (tx, _rx) = mpsc::channel::<EventRecord>(1);
        let sender = EventsSender { tx };

        // 첫 이벤트는 들어가고, 두 번째는 채널 포화로 드롭 → emit이 panic하지 않고 반환
        sender.emit(sample_record());
        sender.emit(sample_record());
        sender.emit(sample_record());
        // panic 없이 여기 도달했으면 OK
    }

    #[tokio::test(flavor = "current_thread")]
    async fn start_returns_usable_sender_and_handle() {
        // 비정상 URL이라도 HTTP timeout으로 실패만 할 뿐 start 자체는 성공해야 한다
        let pusher = start(EventsConfig {
            admin_url:        "http://127.0.0.1:1".to_string(),
            batch_size:       10,
            flush_interval:   Duration::from_millis(50),
            channel_capacity: 8,
        });
        pusher.sender.emit(sample_record());
        // 수신자(태스크)가 살아 있어야 한다
        assert!(!pusher.handle.is_finished(), "flush 태스크가 즉시 종료돼선 안 된다");
        // 태스크 abort로 청소
        pusher.handle.abort();
    }
}
