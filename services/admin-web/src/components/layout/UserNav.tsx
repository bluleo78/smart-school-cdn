/** 사이드바 하단 사용자 프로파일 메뉴 — 클릭 시 드롭다운(상단으로 펼침)에 로그아웃 등 */
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/use-auth';
import { Avatar, AvatarFallback } from '../ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/** 사용자명 첫 글자(대문자)를 Avatar fallback 으로 사용 */
function getInitial(username: string): string {
  return username.charAt(0).toUpperCase();
}

export function UserNav() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();

  if (state.status !== 'authenticated') return null;
  const user = state.user;

  // 로그아웃 — 서버 쿠키 만료 후 /login 으로 이동(replace 로 히스토리 잔존 방지)
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md p-2 px-3 text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
            {getInitial(user.username)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 text-left min-w-0">
          <p className="truncate font-medium leading-tight text-foreground">
            {user.username}
          </p>
          <p className="truncate text-xs text-muted-foreground leading-tight">
            관리자
          </p>
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="font-semibold">{user.username}</p>
            <p className="text-xs text-muted-foreground">관리자</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} data-testid="user-nav-logout">
          <LogOut />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
