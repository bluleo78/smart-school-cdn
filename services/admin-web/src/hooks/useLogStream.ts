/// 실시간 로그 SSE 스트림 훅
/// EventSource로 /api/logs/:service를 구독하고 링 버퍼로 최근 1000줄을 유지한다.
import { useEffect, useCallback, useReducer } from 'react';
import { stripAnsi } from '../lib/stripAnsi';

/** 로그 한 줄의 데이터 구조 */
export interface LogLine {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  service: string;
}

/** 링 버퍼 최대 크기 — 초과 시 오래된 줄부터 제거 */
const MAX_LINES = 1000;

/** 스트림 상태 */
interface StreamState {
  lines: LogLine[];
  isConnected: boolean;
  error: string | null;
}

type StreamAction =
  | { type: 'RESET' }
  | { type: 'CONNECTED' }
  | { type: 'DISCONNECTED'; error: string | null }
  | { type: 'APPEND'; line: LogLine }
  | { type: 'CLEAR' };

const initialState: StreamState = {
  lines: [],
  isConnected: false,
  error: null,
};

/** 스트림 상태 리듀서 — 모든 상태 전환을 단일 dispatch로 처리 */
function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'RESET':
      return initialState;
    case 'CONNECTED':
      return { ...state, isConnected: true, error: null };
    case 'DISCONNECTED':
      return { ...state, isConnected: false, error: action.error };
    case 'APPEND': {
      const next = [...state.lines, action.line];
      return {
        ...state,
        lines: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next,
      };
    }
    case 'CLEAR':
      return { ...state, lines: [] };
    default:
      return state;
  }
}

/**
 * 실시간 로그 스트림 훅
 * @param service - 대상 서비스명 (proxy/storage/tls/dns/optimizer/admin)
 * @param tail - 초기 히스토리 줄 수 (기본 100)
 * @returns lines, isConnected, error, clear
 */
export function useLogStream(service: string, tail = 100) {
  const [state, dispatch] = useReducer(streamReducer, initialState);

  /** 로그 버퍼 초기화 */
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  useEffect(() => {
    if (!service) return;

    // 서비스 변경 시 상태 일괄 초기화 — useReducer dispatch는 effect 내 동기 호출 허용
    dispatch({ type: 'RESET' });

    const es = new EventSource(`/api/logs/${service}?tail=${tail}&follow=true`);

    es.onopen = () => {
      dispatch({ type: 'CONNECTED' });
    };

    es.onmessage = (event) => {
      try {
        const logLine: LogLine = JSON.parse(event.data as string);
        // Rust 서비스 컬러 출력으로 인한 ANSI escape code 제거 — UI 판독성 확보
        const cleanLine: LogLine = { ...logLine, message: stripAnsi(logLine.message) };
        dispatch({ type: 'APPEND', line: cleanLine });
      } catch {
        // JSON 파싱 실패 — 무시
      }
    };

    es.onerror = () => {
      // EventSource 사양상 4xx 응답·CORS 실패·서버 종료 시 readyState=CLOSED(2)로 영구 종료되며
      // 브라우저는 재연결을 시도하지 않는다 (WHATWG HTML §9.2). 반대로 일시적 네트워크 끊김은
      // readyState=CONNECTING(1)에서 자동 재연결 단계로 진입한다. 두 상태를 구분해 안내한다.
      // refs #317: 401/403 시 '자동 재연결 중...' 거짓 메시지로 사용자 혼란 방지.
      if (es.readyState === EventSource.CLOSED) {
        // CLOSED 진입 시 인증 만료(401/403) 가능성을 즉시 확인한다.
        // axios 인터셉터(api.ts)는 EventSource 호출에 관여하지 않으므로 여기서 별도 점검.
        // /auth/state 호출 시 401이면 인터셉터가 자동 /login 리다이렉트를 트리거한다.
        void fetch('/api/auth/state', { credentials: 'include' })
          .then((r) => {
            if (r.status === 401 || r.status === 403) {
              const from = window.location.pathname + window.location.search;
              window.location.href = `/login?from=${encodeURIComponent(from)}`;
              return;
            }
            dispatch({
              type: 'DISCONNECTED',
              error: '로그 스트림이 종료되었습니다. 페이지를 새로고침하면 다시 연결됩니다.',
            });
          })
          .catch(() => {
            // 네트워크 자체가 안 되는 경우 — 자동 재연결도 의미 없음
            dispatch({
              type: 'DISCONNECTED',
              error: '로그 스트림이 종료되었습니다. 페이지를 새로고침하면 다시 연결됩니다.',
            });
          });
        return;
      }
      // CONNECTING(1) — 브라우저가 자체 재연결을 시도 중인 정상 케이스
      dispatch({ type: 'DISCONNECTED', error: '로그 스트림 연결이 끊어졌습니다. 자동 재연결 중...' });
    };

    return () => {
      es.close();
      dispatch({ type: 'DISCONNECTED', error: null });
    };
  }, [service, tail]);

  return { lines: state.lines, isConnected: state.isConnected, error: state.error, clear };
}
