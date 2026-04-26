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
      dispatch({ type: 'DISCONNECTED', error: '로그 스트림 연결이 끊어졌습니다. 자동 재연결 중...' });
    };

    return () => {
      es.close();
      dispatch({ type: 'DISCONNECTED', error: null });
    };
  }, [service, tail]);

  return { lines: state.lines, isConnected: state.isConnected, error: state.error, clear };
}
