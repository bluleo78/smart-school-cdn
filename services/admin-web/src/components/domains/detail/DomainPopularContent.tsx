/// 도메인 통계 탭 — 인기 콘텐츠 테이블 (경로, 크기, 히트 수 최대 10개)
import { useDomainPopular } from '../../../hooks/useDomainPopular';
import { formatBytes } from '../../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';

interface Props {
  host: string;
}

export function DomainPopularContent({ host }: Props) {
  const { data, isLoading } = useDomainPopular(host);

  return (
    <Card variant="glass" data-testid="domain-popular-content">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">인기 콘텐츠</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">로드 중...</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">캐시된 콘텐츠가 없습니다</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">경로</TableHead>
                <TableHead className="text-xs text-right">크기</TableHead>
                <TableHead className="text-xs text-right">히트 수</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.slice(0, 10).map((entry) => (
                <TableRow key={entry.url}>
                  {/* URL에서 경로 부분만 표시 */}
                  <TableCell className="text-xs font-mono truncate max-w-xs">
                    {(() => {
                      try {
                        return new URL(entry.url).pathname;
                      } catch {
                        return entry.url;
                      }
                    })()}
                  </TableCell>
                  <TableCell className="text-xs text-right">
                    {formatBytes(entry.size_bytes)}
                  </TableCell>
                  <TableCell className="text-xs text-right">{entry.hit_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
