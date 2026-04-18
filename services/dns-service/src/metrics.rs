/// DNS 서비스의 인메모리 메트릭과 최근 쿼리 링버퍼를 관리한다.
/// 외부 의존성 없이 std::sync만 사용 (AtomicU64 + Mutex<VecDeque>).
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryResult {
    Matched,
    Nxdomain,
    Forwarded,
}

impl QueryResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            QueryResult::Matched   => "matched",
            QueryResult::Nxdomain  => "nxdomain",
            QueryResult::Forwarded => "forwarded",
        }
    }
}

#[derive(Debug, Clone)]
pub struct QueryEntry {
    pub ts_unix_ms: i64,
    pub client_ip:  String,
    pub qname:      String,
    pub qtype:      String,
    pub result:     QueryResult,
    pub latency_us: u32,
}

pub struct DnsMetrics {
    total:     AtomicU64,
    matched:   AtomicU64,
    nxdomain:  AtomicU64,
    forwarded: AtomicU64,
    started:   Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MetricsSnapshot {
    pub total: u64,
    pub matched: u64,
    pub nxdomain: u64,
    pub forwarded: u64,
    pub uptime_secs: u64,
}

impl DnsMetrics {
    pub fn new() -> Self {
        Self {
            total: AtomicU64::new(0),
            matched: AtomicU64::new(0),
            nxdomain: AtomicU64::new(0),
            forwarded: AtomicU64::new(0),
            started: Instant::now(),
        }
    }

    /// 결과 분류에 따라 total과 해당 카운터를 원자적으로 증가
    pub fn record(&self, result: QueryResult) {
        self.total.fetch_add(1, Ordering::Relaxed);
        match result {
            QueryResult::Matched   => { self.matched.fetch_add(1, Ordering::Relaxed); }
            QueryResult::Nxdomain  => { self.nxdomain.fetch_add(1, Ordering::Relaxed); }
            QueryResult::Forwarded => { self.forwarded.fetch_add(1, Ordering::Relaxed); }
        }
    }

    pub fn snapshot(&self) -> MetricsSnapshot {
        MetricsSnapshot {
            total:       self.total.load(Ordering::Relaxed),
            matched:     self.matched.load(Ordering::Relaxed),
            nxdomain:    self.nxdomain.load(Ordering::Relaxed),
            forwarded:   self.forwarded.load(Ordering::Relaxed),
            uptime_secs: self.started.elapsed().as_secs(),
        }
    }
}

/// 최근 쿼리 FIFO 링버퍼 — 용량 초과 시 가장 오래된 항목부터 제거
pub struct RecentQueries {
    inner: Mutex<VecDeque<QueryEntry>>,
    cap:   usize,
}

impl RecentQueries {
    pub fn new(cap: usize) -> Self {
        Self { inner: Mutex::new(VecDeque::with_capacity(cap)), cap }
    }

    pub fn push(&self, entry: QueryEntry) {
        let mut q = self.inner.lock().expect("RecentQueries mutex poisoned");
        if q.len() == self.cap {
            q.pop_back();
        }
        q.push_front(entry);
    }

    /// 최신순 상위 limit개 스냅샷 복사
    pub fn snapshot(&self, limit: usize) -> Vec<QueryEntry> {
        let q = self.inner.lock().expect("RecentQueries mutex poisoned");
        q.iter().take(limit).cloned().collect()
    }

    /// 링버퍼 전체 순회 → qname별 빈도 집계 → 상위 n개 (동률은 qname 오름차순)
    pub fn top_qnames(&self, n: usize) -> Vec<(String, u32)> {
        let q = self.inner.lock().expect("RecentQueries mutex poisoned");
        let mut counts: HashMap<&str, u32> = HashMap::new();
        for e in q.iter() {
            *counts.entry(e.qname.as_str()).or_default() += 1;
        }
        let mut v: Vec<(String, u32)> =
            counts.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        v.truncate(n);
        v
    }
}

pub type SharedMetrics = Arc<DnsMetrics>;
pub type SharedRecent  = Arc<RecentQueries>;

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(qn: &str) -> QueryEntry {
        QueryEntry {
            ts_unix_ms: 0,
            client_ip: "0.0.0.0".into(),
            qname: qn.to_string(),
            qtype: "A".into(),
            result: QueryResult::Matched,
            latency_us: 0,
        }
    }

    #[test]
    fn dns_metrics_는_결과별_카운터를_증가시킨다() {
        let m = DnsMetrics::new();
        m.record(QueryResult::Matched);
        m.record(QueryResult::Matched);
        m.record(QueryResult::Forwarded);
        m.record(QueryResult::Nxdomain);
        let s = m.snapshot();
        assert_eq!(s.total, 4);
        assert_eq!(s.matched, 2);
        assert_eq!(s.forwarded, 1);
        assert_eq!(s.nxdomain, 1);
    }

    #[test]
    fn recent_queries_는_용량_초과시_오래된_항목을_제거한다() {
        let r = RecentQueries::new(3);
        for i in 0..5 {
            r.push(QueryEntry { ts_unix_ms: i, ..mk(&format!("q{i}")) });
        }
        let snap = r.snapshot(10);
        assert_eq!(snap.len(), 3);
        assert_eq!(snap[0].qname, "q4"); // push_front이므로 최신이 앞
        assert_eq!(snap[2].qname, "q2");
    }

    #[test]
    fn top_qnames_는_빈도순으로_반환하고_동률은_qname_오름차순() {
        let r = RecentQueries::new(100);
        for _ in 0..3 { r.push(mk("a")); }
        for _ in 0..5 { r.push(mk("b")); }
        for _ in 0..3 { r.push(mk("c")); }
        let top = r.top_qnames(3);
        assert_eq!(top, vec![
            ("b".to_string(), 5),
            ("a".to_string(), 3),
            ("c".to_string(), 3),
        ]);
    }

    #[test]
    fn top_qnames_는_빈_버퍼에서_빈_벡터를_반환() {
        let r = RecentQueries::new(10);
        assert!(r.top_qnames(5).is_empty());
    }
}
