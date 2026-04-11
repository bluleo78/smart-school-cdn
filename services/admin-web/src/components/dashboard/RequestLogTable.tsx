/// 최근 프록시 요청 로그를 테이블로 보여주는 컴포넌트
/// 5초 간격으로 API를 폴링하여 최신 로그를 표시한다.
import { useProxyRequests } from '../../hooks/useProxyRequests';

/** 상태코드에 따른 배지 색상 반환
 *  2xx: 초록 (성공), 3xx: 파랑 (리다이렉트), 4xx: 노랑 (클라이언트 에러), 5xx: 빨강 (서버 에러) */
function statusColor(code: number): string {
  if (code < 300) return 'bg-green-100 text-green-700';
  if (code < 400) return 'bg-blue-100 text-blue-700';
  if (code < 500) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

/** ISO 타임스탬프를 "HH:MM:SS" 형식으로 변환 */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('ko-KR', { hour12: false });
}

export function RequestLogTable() {
  const { data: logs, isLoading } = useProxyRequests();

  // 로딩 중일 때 스켈레톤 표시
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6" data-testid="request-log-loading">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  // 로그가 없을 때 안내 메시지
  if (!logs || logs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-3">최근 요청 로그</h3>
        <p className="text-gray-400 text-sm">요청 로그가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-3">최근 요청 로그</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="pb-2 pr-4 font-medium">시간</th>
              <th className="pb-2 pr-4 font-medium">메서드</th>
              <th className="pb-2 pr-4 font-medium">Host</th>
              <th className="pb-2 pr-4 font-medium">URL</th>
              <th className="pb-2 pr-4 font-medium">상태</th>
              <th className="pb-2 font-medium">응답시간</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={`${log.timestamp}-${log.host}-${log.url}`} className="border-b border-gray-50">
                <td className="py-2 pr-4 text-gray-500">{formatTime(log.timestamp)}</td>
                <td className="py-2 pr-4 font-mono">{log.method}</td>
                <td className="py-2 pr-4 text-gray-600">{log.host}</td>
                <td className="py-2 pr-4 font-mono text-gray-800 max-w-xs truncate">{log.url}</td>
                <td className="py-2 pr-4">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(log.status_code)}`}>
                    {log.status_code}
                  </span>
                </td>
                <td className="py-2 text-gray-600">{log.response_time_ms}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
