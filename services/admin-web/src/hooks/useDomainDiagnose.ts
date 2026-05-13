/// 도메인 + URL + 기간 조합으로 단일 URL 진단 데이터를 조회하는 TanStack Query 훅 (#387)
/// path 가 `/` 로 시작하지 않을 때는 enabled=false 로 두어 진단 입력이 유효해진 시점부터 호출한다.
import { useQuery } from '@tanstack/react-query';
import { fetchDomainDiagnose, type DiagnoseRange } from '../api/diagnose';

export interface UseDomainDiagnoseArgs {
  host: string;
  /** `/` 로 시작해야 함 — 빈 문자열이면 비활성화 */
  path: string;
  /** raw query string (선택) */
  query: string;
  range: DiagnoseRange;
}

export function useDomainDiagnose(args: UseDomainDiagnoseArgs) {
  return useQuery({
    queryKey: ['domain-diagnose', args.host, args.path, args.query, args.range] as const,
    queryFn: () => fetchDomainDiagnose(args.host, { path: args.path, query: args.query, range: args.range }),
    enabled: !!args.host && args.path.startsWith('/'),
    staleTime: 30_000,
  });
}
