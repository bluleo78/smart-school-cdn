import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  LayoutDashboard,
  Globe,
  Settings,
  Network,
  Users as UsersIcon,
  Menu as MenuIcon,
  Layers,
} from 'lucide-react';
import { useAuth } from '../auth/use-auth';
import { UserNav } from './UserNav';

/** 사이드바 네비게이션 항목 — 대시보드/도메인/DNS/사용자/시스템 */
const navItems = [
  { to: '/', icon: LayoutDashboard, label: '대시보드' },
  { to: '/domains', icon: Globe, label: '도메인 관리' },
  { to: '/dns', icon: Network, label: 'DNS' },
  { to: '/users', icon: UsersIcon, label: '사용자 관리' },
  { to: '/system', icon: Settings, label: '시스템' },
];

export function AppLayout() {
  const { state } = useAuth();
  const location = useLocation();

  // 모바일 사이드바 열림 상태 — 라우트 변경 시 자동 닫힘
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 라우트 변경에 따른 UI 상태 동기화
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 모바일 백드롭 — 사이드바 열렸을 때만 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 사이드바 — 흰색/뉴트럴, 모바일에서는 fixed translate */}
      <aside
        className={`w-60 bg-sidebar-bg border-r border-sidebar-border flex flex-col shrink-0
                    fixed lg:static inset-y-0 left-0 z-30
                    transition-transform duration-200
                    ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div className="h-14 flex items-center px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Layers size={18} />
            </div>
            <h1 className="text-sm font-semibold leading-tight text-foreground">
              Smart School CDN
            </h1>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium nav-active-indicator'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* 사이드바 하단 사용자 메뉴 — 인증된 경우에만 노출 */}
        {state.status === 'authenticated' && (
          <div className="shrink-0 border-t border-sidebar-border p-2">
            <UserNav />
          </div>
        )}
      </aside>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 헤더 — h-14 고정, sticky + backdrop-blur */}
        {state.status === 'authenticated' && (
          <header className="h-14 px-4 md:px-6 flex items-center justify-between border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <button
                aria-label="메뉴 열기"
                className="lg:hidden p-2 -ml-2 rounded-md hover:bg-accent text-foreground"
                onClick={() => setMobileOpen(true)}
              >
                <MenuIcon size={18} />
              </button>
            </div>
            <div className="flex items-center gap-3" />
          </header>
        )}
        <main className="flex-1 overflow-auto bg-gradient-main">
          <div className="p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
