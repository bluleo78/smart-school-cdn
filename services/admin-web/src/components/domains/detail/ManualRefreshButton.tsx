/// 수동 새로고침 버튼. 클릭 중에는 회전 애니메이션.
import { RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button';

interface Props {
  onClick: () => void;
  isRefreshing?: boolean;
}

export function ManualRefreshButton({ onClick, isRefreshing }: Props) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={isRefreshing}
      size="icon"
      aria-label="새로고침"
      data-testid="manual-refresh-btn"
    >
      <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
    </Button>
  );
}
