/** 시스템 페이지 v2
 * - 서버 업타임 표시 (ProxyStatus.uptime 활용)
 * - 디스크 사용량 경고 배너 (90% 이상 시 표시)
 * - CA 인증서 다운로드 (iPad/PC 설치용)
 * - 발급된 인증서 목록 테이블
 */
import { useProxyStatus } from '../hooks/useProxyStatus';
import { useCacheStats } from '../hooks/useCacheStats';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { downloadCACert, downloadMobileConfig } from '../api/tls';
import { useCertificates } from '../hooks/useTls';

/** 초 → "X일 X시간 X분" 포맷 변환 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}일`);
  if (hours > 0) parts.push(`${hours}시간`);
  parts.push(`${minutes}분`);
  return parts.join(' ');
}

/** 인증서 만료일 기준 상태 배지 반환 */
function certStatusBadge(expiresAt: string) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return <Badge variant="destructive">만료</Badge>;
  if (days < 7) return <Badge variant="outline" className="border-yellow-400 text-yellow-700">경고</Badge>;
  return <Badge variant="outline" className="border-green-500 text-green-700">활성</Badge>;
}

export function SystemPage() {
  const { data: status } = useProxyStatus();
  const { data: cache } = useCacheStats();
  const { data: certificates } = useCertificates();

  const diskUsageRatio =
    cache && cache.max_size_bytes > 0
      ? cache.total_size_bytes / cache.max_size_bytes
      : 0;
  const diskUsagePercent = Math.round(diskUsageRatio * 100);
  const isDiskWarning = diskUsageRatio >= 0.9;

  const diskUsedGB = cache
    ? (cache.total_size_bytes / 1024 ** 3).toFixed(1)
    : '-';
  const diskMaxGB = cache
    ? (cache.max_size_bytes / 1024 ** 3).toFixed(1)
    : '-';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">시스템</h2>

      {/* 디스크 사용량 경고 배너 */}
      {isDiskWarning && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-semibold">
            캐시 디스크 사용량이 {diskUsagePercent}%입니다.
          </p>
          <p className="mt-1 text-sm">
            오래된 캐시를 퍼지하거나 최대 용량을 늘리세요.{' '}
            <Link to="/cache" className="underline">
              캐시 관리 페이지로 이동
            </Link>
          </p>
        </div>
      )}

      {/* 서버 업타임 */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-700">서버 업타임</h3>
        <p
          data-testid="uptime-value"
          className="text-3xl font-bold text-gray-900"
        >
          {status ? formatUptime(status.uptime) : '로딩 중…'}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {status?.online ? '● 온라인' : '○ 오프라인'}
        </p>
      </div>

      {/* 캐시 디스크 사용량 */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-700">
          캐시 디스크 사용량
        </h3>
        <div className="mb-2 flex justify-between text-sm text-gray-600">
          <span>{diskUsedGB} GB 사용</span>
          <span>{diskMaxGB} GB 최대</span>
        </div>
        <div
          data-testid="disk-usage-bar"
          className="h-3 w-full overflow-hidden rounded-full bg-gray-200"
        >
          <div
            className={`h-full rounded-full transition-all ${
              isDiskWarning ? 'bg-red-500' : 'bg-blue-500'
            }`}
            style={{ width: `${diskUsagePercent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">{diskUsagePercent}% 사용 중</p>
      </div>

      {/* CA 인증서 설치 */}
      <div data-testid="ca-cert-card" className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-1 text-lg font-semibold text-gray-700">CA 인증서</h3>
        <p className="mb-4 text-sm text-gray-500">
          iPad 또는 PC에 설치하면 HTTPS 콘텐츠를 캐싱합니다.
        </p>
        <div className="flex gap-3">
          <Button data-testid="ca-download-btn" variant="outline" onClick={downloadCACert}>
            .crt 다운로드
          </Button>
          <Button data-testid="mobileconfig-download-btn" variant="outline" onClick={downloadMobileConfig}>
            iOS 프로파일 다운로드
          </Button>
        </div>
        <div className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
          <p className="font-medium">iPad 설치 방법</p>
          <ol className="mt-1 list-decimal pl-4 space-y-1">
            <li>Safari에서 <strong>iOS 프로파일 다운로드</strong> 클릭</li>
            <li>설정 앱 → <em>프로파일이 다운로드됨</em> → 설치</li>
            <li>설정 → 일반 → 정보 → 인증서 신뢰 설정 → Smart School CDN CA 신뢰 활성화</li>
          </ol>
        </div>
      </div>

      {/* 발급된 인증서 목록 */}
      <div data-testid="certificates-card" className="rounded-lg border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-700">발급된 인증서</h3>
        {certificates && certificates.length > 0 ? (
          <table data-testid="certificates-table" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4 font-medium">도메인</th>
                <th className="pb-2 pr-4 font-medium">발급일</th>
                <th className="pb-2 pr-4 font-medium">만료일</th>
                <th className="pb-2 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((cert) => (
                <tr key={cert.domain} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono">{cert.domain}</td>
                  <td className="py-2 pr-4 text-gray-600">
                    {new Date(cert.issued_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {new Date(cert.expires_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="py-2">{certStatusBadge(cert.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p data-testid="certificates-empty" className="text-sm text-gray-400">
            아직 발급된 인증서가 없습니다. HTTPS 요청이 들어오면 자동으로 발급됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
