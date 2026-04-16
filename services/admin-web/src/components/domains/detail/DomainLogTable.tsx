/// 도메인 요청 로그 테이블 — 검색/에러 필터, 30초 자동 갱신
import { useState } from 'react';
import { useDomainLogs } from '../../../hooks/useDomainLogs';
import { formatBytes } from '../../../lib/format';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';

interface Props {
  host: string;
}

/** HTTP 상태 코드별 색상 클래스 반환 */
function statusColor(code: number): string {
  if (code >= 500) return 'text-destructive';
  if (code >= 400) return 'text-yellow-400';
  return 'text-green-400';
}

/** 캐시 상태별 색상 클래스 반환 */
function cacheColor(status: 'HIT' | 'MISS'): string {
  return status === 'HIT' ? 'text-green-400' : 'text-destructive';
}

export function DomainLogTable({ host }: Props) {
  /** 검색어 필터 state */
  const [search, setSearch] = useState('');
  /** 에러만 표시 토글 state */
  const [errorsOnly, setErrorsOnly] = useState(false);

  const { data, isLoading, error } = useDomainLogs(host, { limit: 200 });

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (error) {
    return <p className="text-sm text-destructive">로그 로드 실패</p>;
  }

  const logs = data ?? [];

  /** 필터 적용: 검색어 + 에러만 */
  const filtered = logs.filter((log) => {
    if (errorsOnly && log.status_code < 400) return false;
    if (search && !log.path.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* 필터 바 */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="경로 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-xs"
        />
        <Button
          variant={errorsOnly ? 'default' : 'outline'}
          onClick={() => setErrorsOnly((v) => !v)}
          aria-pressed={errorsOnly}
          className="h-8 text-xs py-1 px-3"
        >
          에러만
        </Button>
      </div>

      {/* 로그 테이블 */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">로그가 없습니다</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/40">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">시간</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">상태</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">캐시</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">경로</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">크기</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, i) => (
                <tr
                  key={i}
                  className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors"
                >
                  {/* 타임스탬프(초) → 시:분:초 */}
                  <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                    {new Date(log.timestamp * 1000).toLocaleTimeString('ko-KR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </td>
                  <td className={`px-3 py-1.5 font-medium ${statusColor(log.status_code)}`}>
                    {log.status_code}
                  </td>
                  <td className={`px-3 py-1.5 font-medium ${cacheColor(log.cache_status)}`}>
                    {log.cache_status}
                  </td>
                  <td className="px-3 py-1.5 text-foreground max-w-[320px] truncate">
                    {log.path}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {formatBytes(log.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
