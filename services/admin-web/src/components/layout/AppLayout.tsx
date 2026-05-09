import { useEffect, useRef, useState } from 'react';
import { matchPath, NavLink, Outlet, useLocation, useNavigationType } from 'react-router';
import {
  LayoutDashboard,
  Globe,
  Settings,
  Network,
  Users as UsersIcon,
  Menu as MenuIcon,
  Layers,
  X as XIcon,
} from 'lucide-react';
import { useAuth } from '../auth/use-auth';
import { UserNav } from './UserNav';
// 전역 TooltipProvider — Radix Tooltip이 동작하려면 트리 최상위에 한 번만 있어야 한다
import { TooltipProvider } from '../ui/tooltip';
// 본문 영역 한정 ErrorBoundary — 한 페이지의 렌더 예외가 사이드바/헤더까지 죽이지 않도록 격리 (#372)
import { ErrorBoundary } from '../error/ErrorBoundary';

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
  // 라우트 전환 종류(POP=뒤로/앞으로, PUSH=새 진입, REPLACE=치환) — 스크롤 복원/초기화 분기 기준
  const navigationType = useNavigationType();

  // 메인 콘텐츠 영역 ref — 페이지 이동 시 스크롤 위치 초기화/복원에 사용
  // window가 아닌 <main> 요소에 overflow-auto가 적용되므로 ref로 직접 참조
  const mainRef = useRef<HTMLElement>(null);

  // 라우트별 스크롤 위치 저장소 — location.key를 키로 사용 (같은 path여도 history entry마다 별도 키).
  // useRef로 보관해 컴포넌트 리렌더에 영향 받지 않고, AppLayout 인스턴스 유지 동안 누적된다.
  const scrollPositions = useRef<Map<string, number>>(new Map());

  // 모바일 사이드바 열림 상태 — 라우트 변경 시 자동 닫힘
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 라우트 변경에 따른 UI 상태 동기화
    setMobileOpen(false);
  }, [location.pathname]);

  // 모바일 사이드바가 열려 있을 때만 ESC 키 리스너 등록 — 키보드 사용자에게 닫기 경로 제공.
  // 데스크톱(lg+)에서는 사이드바가 항상 보이므로 등록 자체를 생략(불필요한 keydown 핸들러 회피).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  // 페이지 이동 시 스크롤 위치 처리 — POP/PUSH/REPLACE를 구분해 분기 (#324)
  // - PUSH/REPLACE: 새로 진입한 화면이므로 상단(0)으로 초기화 (#146 동작 유지)
  // - POP: 브라우저 뒤로/앞으로 — 이전에 기억해 둔 scrollTop으로 복원해야 흐름이 끊기지 않음
  // BrowserRouter는 데이터 라우터가 아니라 <ScrollRestoration />이 없고,
  // 스크롤 컨테이너가 window가 아닌 <main>(overflow-auto)이라 브라우저 자동 복원 대상도 아니므로
  // location.key를 키로 한 Map에 직접 기록/복원한다.
  //
  // 스크롤 보존 전략: <main>에 scroll 이벤트 리스너를 달아 사용자가 스크롤할 때마다
  // "현재 라우트 키" 자리에 scrollTop을 누적 기록한다. 라우트 변경 시점에 한 번 읽는 방식
  // (effect cleanup 등)은 새 페이지로 교체되며 scrollHeight가 줄어들면 scrollTop이 0으로
  // 자동 클램프되어 정확한 값을 잡지 못한다.
  const currentKeyRef = useRef(location.key);
  useEffect(() => {
    currentKeyRef.current = location.key;
  }, [location.key]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // 사용자 스크롤을 추적해 현재 라우트 키 자리에 위치를 누적 보존
    const onScroll = () => {
      scrollPositions.current.set(currentKeyRef.current, main.scrollTop);
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // POP이면 저장된 위치(없으면 0), 그 외(PUSH/REPLACE)는 상단으로 초기화
    const target =
      navigationType === 'POP'
        ? (scrollPositions.current.get(location.key) ?? 0)
        : 0;
    main.scrollTo({ top: target, behavior: 'instant' });
  }, [location.key, navigationType]);

  // 페이지 이동 시 document.title 업데이트 — WCAG 2.4.2 Page Titled 준수
  // 알려진 라우트인지 판별은 App.tsx의 라우트 정의와 동일한 패턴 목록으로 matchPath 검사한다.
  // 과거 startsWith(`${to}/`) 기반 세그먼트 경계 검사는 `/dns/random-subpath`처럼
  // `/dns` 직하위에 라우트가 등록되지 않은 미지의 서브 path까지 부모 라벨("DNS")로
  // 흡수해 404 화면인데 부모 메뉴 라벨이 노출되는 회귀를 만들었다 (#323).
  // 라우트 정의 자체와 1:1로 비교해 unknown 여부를 판정한다.
  const knownRoutePatterns = [
    '/',
    '/domains',
    '/domains/:host',
    '/cache',
    '/optimizer',
    '/dns',
    '/users',
    '/system',
    // DEV 전용 ErrorBoundary E2E 라우트 — App.tsx와 동일하게 DEV 빌드에서만 known 처리
    ...(import.meta.env.DEV ? ['/__e2e/throw'] : []),
  ];
  const isKnownRoute = knownRoutePatterns.some((pattern) =>
    matchPath({ path: pattern, end: true }, location.pathname),
  );
  const isUnknownRoute = !isKnownRoute;

  // /domains/:host 같은 서브 라우트는 자식 컴포넌트(DomainDetailPageInner)가
  // 호스트명을 포함한 title을 직접 설정하므로 AppLayout은 덮어쓰지 않는다.
  // React effects는 자식 → 부모 순으로 실행되므로 이 가드 없이는 부모 effect가
  // 자식이 설정한 title을 덮어쓰게 된다.
  const isDomainDetail = /^\/domains\/[^/]+/.test(location.pathname);

  // 알려진 라우트일 때만 navItems에서 라벨을 찾는다. 정확한 path 일치 또는
  // `${to}/` 직하위(예: /domains/123)일 때 부모 메뉴 라벨을 사용한다.
  // 라우트 정의 기반 isKnownRoute 가드가 unknown을 먼저 걸러내므로
  // 여기서의 startsWith는 #323 같은 false-positive를 만들지 않는다.
  const matchedNavLabel = isUnknownRoute
    ? undefined
    : navItems.find(({ to }) => {
        if (to === '/') return location.pathname === '/';
        return location.pathname === to || location.pathname.startsWith(`${to}/`);
      })?.label;
  const currentPageLabel = isUnknownRoute
    ? '페이지를 찾을 수 없음'
    : (matchedNavLabel ?? '');

  useEffect(() => {
    if (isDomainDetail) return;
    document.title = currentPageLabel
      ? `${currentPageLabel} | Smart School CDN`
      : 'Smart School CDN';
  }, [currentPageLabel, isDomainDetail]);

  return (
    // TooltipProvider로 전체 레이아웃을 감싸 — 하위 어떤 컴포넌트에서도 Tooltip 사용 가능
    <TooltipProvider>
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
        <div className="h-14 flex items-center justify-between px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Layers size={18} />
            </div>
            <h1 className="text-sm font-semibold leading-tight text-foreground">
              Smart School CDN
            </h1>
          </div>
          {/* 모바일 전용 닫기(X) 버튼 — 사이드바 헤더 우측에 배치.
              데스크톱(lg+)에서는 사이드바가 상시 노출되므로 lg:hidden으로 감춘다.
              백드롭 탭 외에 명시적 close affordance를 제공해 보조기기/터치 사용자 접근성 향상. */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            className="lg:hidden p-2 -mr-2 rounded-md hover:bg-accent text-foreground shrink-0"
            onClick={() => setMobileOpen(false)}
          >
            <XIcon size={18} />
          </button>
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
          <header className="h-14 px-4 md:px-6 flex items-center gap-3 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
            {/* 모바일 햄버거 버튼 — 데스크탑에서 숨김 */}
            <button
              aria-label="메뉴 열기"
              className="lg:hidden p-2 -ml-2 rounded-md hover:bg-accent text-foreground shrink-0"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon size={18} />
            </button>
            {/* 현재 페이지 제목 — navItems에서 pathname 매핑,
                서브 라우트(예: /domains/123)는 상위 경로로 fallback,
                알 수 없는 경로(NotFoundPage)는 "페이지를 찾을 수 없음" 표시 (#180) */}
            <span className="text-sm font-medium text-foreground truncate">
              {currentPageLabel}
            </span>
          </header>
        )}
        <main ref={mainRef} className="flex-1 overflow-auto bg-gradient-main">
          <div className="p-4 md:p-6">
            {/* 라우트 단위 ErrorBoundary — 본문(<Outlet/>)에서 발생한 렌더 예외를
                사이드바/헤더는 유지한 채 본문 영역만 폴백으로 대체한다.
                resetKey=location.key 로 다른 페이지로 이동하면 자동 복구. (#372) */}
            <ErrorBoundary variant="inline" resetKey={location.key}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
    </TooltipProvider>
  );
}
