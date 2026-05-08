/**
 * 인증 관련 다중 탭 동기화 채널 (#332).
 *
 * 무엇을: 같은 origin 내 여러 탭이 인증/사용자 상태 변화 신호를 주고받기 위한
 * BroadcastChannel('sscdn-auth') 래퍼.
 *
 * 왜: admin 작업(로그아웃, 사용자 비활성화, 비밀번호 재설정)이 일어났을 때
 * 다른 탭은 다음 API 호출 전까지 stale UI를 그대로 유지한다 — 활성 사용자만
 * 보는 액션 버튼이 노출되거나 잠긴 사용자가 멀쩡한 화면을 보고 있다는 잘못된
 * affordance가 발생. 탭 간 즉시 신호 전파로 해결.
 *
 * 폴백: BroadcastChannel 미지원 브라우저(iPad Safari 13 이하 등)는
 * `localStorage` + `storage` 이벤트로 fallback.
 */

/** 인증/사용자 상태 변화 이벤트 — 같은 사용자 id 기준 자기 자신 매칭 시 강제 로그아웃 */
export type AuthBroadcastEvent =
  | { type: 'logout' }
  | { type: 'user-disabled'; userId: number }
  | { type: 'password-changed'; userId: number };

/** BroadcastChannel 채널 이름 — 같은 origin 내 모든 탭이 공유 */
export const AUTH_BROADCAST_CHANNEL = 'sscdn-auth';

/** storage 폴백 키 — 동일 origin localStorage 변화로 다른 탭에 신호 전파 */
const STORAGE_FALLBACK_KEY = 'sscdn-auth-broadcast';

/**
 * 인증 이벤트를 다른 탭에 브로드캐스트.
 *
 * BroadcastChannel 우선 사용, 미지원 시 localStorage write로 폴백.
 * 자기 자신은 수신 대상에서 제외(BroadcastChannel 자체 동작 + storage 이벤트의
 * "다른 탭 한정" 규약).
 */
export function broadcastAuthEvent(event: AuthBroadcastEvent): void {
  // BroadcastChannel — 모던 브라우저 (Chrome/Edge/Firefox/Safari 15.4+)
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      ch.postMessage(event);
      ch.close();
    } catch {
      // BroadcastChannel 사용 실패 시 storage 폴백으로 흐른다
    }
  }
  // storage 이벤트 폴백 — 같은 키에 같은 값을 두 번 써도 발화하도록 timestamp suffix 부여
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const payload = JSON.stringify({ ...event, _ts: Date.now() });
      window.localStorage.setItem(STORAGE_FALLBACK_KEY, payload);
      // 잔재 정리(#345): storage 이벤트는 setItem 시점에 이미 다른 탭으로 발화 완료되었으므로
      // 폴백 신호 데이터를 영구 저장소에 남길 필요가 없다. 같은 탭의 다음 microtask에서
      // 즉시 removeItem 하여 devtools 노출/사용자 전환 시 잔재를 제거한다.
      // (removeItem 자체도 storage 이벤트를 발화하지만 newValue=null 이라 수신측에서 무시)
      queueMicrotask(() => {
        try {
          if (window.localStorage.getItem(STORAGE_FALLBACK_KEY) === payload) {
            window.localStorage.removeItem(STORAGE_FALLBACK_KEY);
          }
        } catch {
          // 정리 실패는 치명적이지 않음 — 다음 broadcast 시 덮어쓰기로 회수
        }
      });
    } catch {
      // quota/private mode 등에서 실패해도 BroadcastChannel 경로가 살아있으면 OK
    }
  }
}

/**
 * 인증 이벤트 구독 — 다른 탭으로부터의 신호를 수신.
 *
 * 반환값은 cleanup 함수로, useEffect 등에서 unmount 시 호출해 리스너 누수 방지.
 * BroadcastChannel + storage 양쪽 모두 등록해 폴백을 함께 활성화.
 */
export function subscribeAuthEvents(handler: (event: AuthBroadcastEvent) => void): () => void {
  const cleanups: Array<() => void> = [];

  // BroadcastChannel 수신
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const ch = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      const onMessage = (e: MessageEvent<AuthBroadcastEvent>) => {
        if (e.data && typeof e.data === 'object' && 'type' in e.data) handler(e.data);
      };
      ch.addEventListener('message', onMessage);
      cleanups.push(() => {
        ch.removeEventListener('message', onMessage);
        ch.close();
      });
    } catch {
      // ignore — storage 폴백으로 충분
    }
  }

  // storage 이벤트 폴백 — 다른 탭에서 localStorage 변경 시 발화 (자기 탭 제외 규약)
  if (typeof window !== 'undefined') {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_FALLBACK_KEY || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue) as AuthBroadcastEvent & { _ts?: number };
        if (data && typeof data === 'object' && 'type' in data) handler(data);
      } catch {
        // 파싱 실패는 잘못된 외부 쓰기 — 무시
      }
    };
    window.addEventListener('storage', onStorage);
    cleanups.push(() => window.removeEventListener('storage', onStorage));
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
