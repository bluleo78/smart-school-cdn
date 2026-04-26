/** 도메인 상세 페이지
 * - /domains/:host 라우트에서 마운트
 * - 404(조회 실패) 시 에러 토스트를 표시한 후 목록 페이지로 리다이렉트
 */
import { useEffect } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useDomain } from '../hooks/useDomain';
import { DomainDetailHeader } from '../components/domains/detail/DomainDetailHeader';
import { DomainDetailTabs } from '../components/domains/detail/DomainDetailTabs';
import { Skeleton } from '../components/ui/skeleton';

export function DomainDetailPage() {
  const { host } = useParams<{ host: string }>();

  // host가 없으면 목록으로 이동 (라우트 미스매치 방어)
  if (!host) return <Navigate to="/domains" replace />;

  return <DomainDetailPageInner host={host} />;
}

/** host 확정 후 데이터 조회 분리 — conditional hook 회피 */
function DomainDetailPageInner({ host }: { host: string }) {
  const { data: domain, isLoading, isError } = useDomain(host);
  const navigate = useNavigate();

  // 도메인 상세 페이지 탭 제목 — AppLayout의 navItems는 /domains/:host를
  // '/domains' 전체로 매핑하므로 항상 '도메인 관리'만 반환한다.
  // 여러 탭에서 동시에 열 때 구분이 불가하므로, 호스트명을 포함한 제목으로 override.
  // 언마운트 시 원래 '도메인 관리' 제목으로 복원한다.
  useEffect(() => {
    document.title = `${host} — 도메인 관리 | Smart School CDN`;
    return () => {
      document.title = '도메인 관리 | Smart School CDN';
    };
  }, [host]);

  // 조회 실패(404 포함) → 에러 토스트를 표시한 뒤 목록으로 이동
  // Navigate 컴포넌트 대신 useEffect를 사용하는 이유:
  // 렌더 중 side-effect(toast 호출)를 일으키면 React 경고가 발생하므로
  // effect 단계에서 toast → navigate 순서로 처리한다.
  useEffect(() => {
    if (isError) {
      toast.error('해당 도메인을 찾을 수 없습니다.');
      navigate('/domains', { replace: true });
    }
  }, [isError, navigate]);

  if (isLoading || !domain) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <DomainDetailHeader domain={domain} />
      <DomainDetailTabs domain={domain} />
    </div>
  );
}
