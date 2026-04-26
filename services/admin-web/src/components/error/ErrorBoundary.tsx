/**
 * 전역 에러 바운더리 — 컴포넌트 렌더 중 발생하는 예외를 포착하여
 * 전체 앱이 화이트스크린으로 크래시되는 것을 방지한다.
 *
 * React는 ErrorBoundary가 없으면 렌더 중 throw된 예외를 컴포넌트 트리
 * 전체를 언마운트하여 처리한다. class component만 componentDidCatch를
 * 구현할 수 있으므로 클래스 방식으로 작성한다.
 */
import { Component, type ReactNode } from 'react';

interface Props {
  /** 정상 렌더링할 자식 컴포넌트 트리 */
  children: ReactNode;
  /** 오류 발생 시 보여줄 대체 UI (미지정 시 기본 폴백 사용) */
  fallback?: ReactNode;
}

interface State {
  /** 포착된 오류 — null이면 정상 상태 */
  error: Error | null;
}

/** 전역 에러 바운더리 — 렌더 예외 포착 및 폴백 UI 표시 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  /**
   * 렌더 중 자식 트리에서 예외 발생 시 state를 업데이트한다.
   * static 메서드로 순수하게 새 state를 반환 — side effect 없음.
   */
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  /**
   * 예외 포착 후 로깅 처리.
   * 운영 환경에서는 외부 에러 트래커(예: Sentry)로 전송할 위치.
   */
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] 컴포넌트 렌더 오류:', error, info.componentStack);
  }

  /**
   * 오류 상태를 초기화하여 자식 컴포넌트를 다시 렌더링한다.
   * 새로고침 없이 복구를 시도할 때 사용.
   */
  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    // 오류 상태: 사용자 지정 폴백이 있으면 그것을, 없으면 기본 폴백 UI 표시
    if (error !== null) {
      if (fallback !== undefined) {
        return fallback;
      }

      // 기본 폴백 — 오류 안내 문구 + 대시보드 복귀 버튼
      return (
        <div
          data-testid="error-boundary-fallback"
          className="flex flex-col items-center justify-center min-h-screen gap-4 text-muted-foreground p-6"
        >
          <p className="text-4xl font-bold text-destructive">⚠</p>
          <p className="text-lg font-semibold text-foreground">오류가 발생했습니다.</p>
          <p className="text-sm text-center max-w-sm">
            예기치 않은 오류가 발생했습니다. 새로고침하거나 대시보드로 돌아가 주세요.
          </p>
          <div className="flex gap-3 mt-2">
            {/* 대시보드 복귀 — href로 하드 네비게이션하여 React 트리 완전 재마운트 */}
            <a
              data-testid="error-boundary-home-btn"
              href="/"
              className="inline-flex items-center justify-center h-9 px-4 text-sm rounded-md font-medium
                bg-primary text-primary-foreground
                hover:bg-primary/90
                transition-colors duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              대시보드로 돌아가기
            </a>
            {/* 새로고침 — React 상태 초기화 없이 복구 시도 */}
            <button
              data-testid="error-boundary-reload-btn"
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center h-9 px-4 text-sm rounded-md font-medium
                bg-card text-foreground border border-border
                hover:bg-accent hover:text-accent-foreground
                transition-colors duration-150
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
