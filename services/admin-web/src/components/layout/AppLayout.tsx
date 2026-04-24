import { NavLink, Outlet, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  Globe,
  Settings,
  Network,
  Users as UsersIcon,
} from 'lucide-react';
import { useAuth } from '../auth/use-auth';
import { Button } from '../ui/button';

/** 사이드바 네비게이션 항목 — 대시보드/도메인/DNS/사용자/시스템 */
const navItems = [
  { to: '/', icon: LayoutDashboard, label: '대시보드' },
  { to: '/domains', icon: Globe, label: '도메인 관리' },
  { to: '/dns', icon: Network, label: 'DNS' },
  { to: '/users', icon: UsersIcon, label: '사용자 관리' },
  { to: '/system', icon: Settings, label: '시스템' },
];

export function AppLayout() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();

  // 로그아웃 — 서버 쿠키 만료 후 /login 으로 이동(replace 로 히스토리 잔존 방지)
  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 사이드바 — 인디고 그라데이션 */}
      <aside className="w-60 bg-gradient-to-b from-sidebar-from to-sidebar-to flex flex-col shrink-0">
        <div className="p-4 border-b border-white/15">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold">SC</span>
            </div>
            <h1 className="text-sm font-bold leading-tight text-white">Smart School CDN</h1>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm transition-colors ${
                  isActive
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 메인 콘텐츠 영역 — 상단 헤더(현재 사용자 + 로그아웃) + Outlet */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 헤더 — 인증된 경우에만 사용자 메일/로그아웃 버튼 노출 */}
        {state.status === 'authenticated' && (
          <header className="flex items-center justify-end gap-3 px-6 py-3 border-b bg-background">
            <span className="text-sm text-muted-foreground">{state.user.username}</span>
            <Button variant="outline" className="px-3 py-1 text-xs" onClick={handleLogout}>
              로그아웃
            </Button>
          </header>
        )}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
