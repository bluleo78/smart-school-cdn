import { NavLink, Outlet } from 'react-router';
import {
  LayoutDashboard,
  Globe,
  Database,
  Zap,
  Settings,
} from 'lucide-react';

/** 사이드바 네비게이션 항목 */
const navItems = [
  { to: '/', icon: LayoutDashboard, label: '대시보드' },
  { to: '/domains', icon: Globe, label: '도메인 관리' },
  { to: '/cache', icon: Database, label: '캐시 관리' },
  { to: '/optimizer', icon: Zap, label: '최적화' },
  { to: '/system', icon: Settings, label: '시스템' },
];

export function AppLayout() {
  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* 사이드바 */}
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold">Smart School CDN</h1>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
