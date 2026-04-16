/** 도메인 상세 페이지
 * - /domains/:host 라우트에서 마운트
 * - 404(조회 실패) 시 목록 페이지로 리다이렉트
 */
import { useParams, Navigate } from 'react-router';
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

  // 조회 실패(404 포함) → 목록으로 리다이렉트
  if (isError) return <Navigate to="/domains" replace />;

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
