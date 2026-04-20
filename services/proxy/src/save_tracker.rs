/// Phase 16-1: 백그라운드 저장 작업이 진행 중인 캐시 키를 추적한다.
/// 2차 MISS 요청이 동일 키로 들어와도 저장을 중복하지 않도록 하는 락 역할만 한다.
/// origin fetch 중복 방지는 `Coalescer`가 담당한다(책임 분리).

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct SaveTracker {
    inner: Arc<Mutex<HashSet<String>>>,
}

impl SaveTracker {
    pub fn new() -> Self { Self::default() }

    /// 아직 등록되지 않은 키라면 삽입 후 `true` 반환(=저장 주체 확정).
    /// 이미 등록되어 있다면 `false` 반환(=다른 태스크가 저장 중, 스킵).
    pub fn try_acquire(&self, key: &str) -> bool {
        let mut set = self.inner.lock().unwrap();
        if set.contains(key) { false } else { set.insert(key.to_string()); true }
    }

    /// 저장 완료 시 키 제거.
    pub fn release(&self, key: &str) {
        let mut set = self.inner.lock().unwrap();
        set.remove(key);
    }

    #[cfg(test)]
    pub fn contains(&self, key: &str) -> bool {
        self.inner.lock().unwrap().contains(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn try_acquire는_최초에만_true를_반환한다() {
        let t = SaveTracker::new();
        assert!(t.try_acquire("k"));
        assert!(!t.try_acquire("k"));
        assert!(t.contains("k"));
    }

    #[test]
    fn release_이후_다시_acquire_가능하다() {
        let t = SaveTracker::new();
        assert!(t.try_acquire("k"));
        t.release("k");
        assert!(!t.contains("k"));
        assert!(t.try_acquire("k"));
    }

    #[test]
    fn 서로_다른_키는_독립적이다() {
        let t = SaveTracker::new();
        assert!(t.try_acquire("a"));
        assert!(t.try_acquire("b"));
        t.release("a");
        assert!(t.contains("b"));
    }
}
