/// 캐시 관리 페이지 — 퍼지 UI + 인기 콘텐츠 테이블
/// 퍼지: URL / 도메인 / 전체 탭 전환, 확인 Dialog, 완료 Toast
import { useState, useRef, useEffect } from 'react';
import { useCacheStats } from '../hooks/useCacheStats';
import { useCachePopular } from '../hooks/useCachePopular';
import { usePurgeCache } from '../hooks/usePurgeCache';
import { formatBytes } from '../lib/format';

type PurgeTab = 'url' | 'domain' | 'all';

export function CachePage() {
  const { data: stats } = useCacheStats();
  const { data: popular } = useCachePopular();
  const purge = usePurgeCache();

  const [activeTab, setActiveTab] = useState<PurgeTab>('url');
  const [urlInput, setUrlInput] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // useEffect로 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function handlePurgeClick() {
    setShowConfirm(true);
  }

  async function handleConfirmPurge() {
    setShowConfirm(false);
    try {
      const req =
        activeTab === 'url'
          ? { type: 'url' as const, target: urlInput }
          : activeTab === 'domain'
            ? { type: 'domain' as const, target: domainInput }
            : { type: 'all' as const };
      const result = await purge.mutateAsync(req);
      setToast(`퍼지 완료 — ${result.purged_count}건 삭제, ${formatBytes(result.freed_bytes)} 해제`);
      setUrlInput('');
      setDomainInput('');
    } catch {
      setToast('퍼지 실패: 서버에 연결할 수 없습니다.');
    }
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  const isPurgeDisabled =
    purge.isPending ||
    (activeTab === 'url' && !urlInput.trim()) ||
    (activeTab === 'domain' && !domainInput.trim());

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">캐시 관리</h2>

      {/* 토스트 알림 */}
      {toast && (
        <div
          className="fixed bottom-4 right-4 bg-gray-800 text-white text-sm px-4 py-3 rounded-lg shadow-lg z-50"
          data-testid="purge-toast"
        >
          {toast}
        </div>
      )}

      {/* 확인 다이얼로그 */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg p-6 w-80 shadow-xl">
            <h3 className="text-base font-semibold mb-2">퍼지 확인</h3>
            <p className="text-sm text-gray-600 mb-4">
              {activeTab === 'all'
                ? '전체 캐시를 삭제합니다. 계속하시겠습니까?'
                : activeTab === 'url'
                  ? `"${urlInput}" 캐시를 삭제합니다.`
                  : `"${domainInput}" 도메인 캐시를 모두 삭제합니다.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                onClick={() => setShowConfirm(false)}
              >
                취소
              </button>
              <button
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                onClick={handleConfirmPurge}
                data-testid="confirm-purge-btn"
              >
                퍼지 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 통계 카드 3열 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">총 캐시 항목</p>
          <p className="text-xl font-bold">{(stats?.entry_count ?? 0).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">사용량</p>
          <p className="text-xl font-bold text-amber-600">
            {formatBytes(stats?.total_size_bytes ?? 0)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">히트율</p>
          <p className="text-xl font-bold text-blue-600">
            {(stats?.hit_rate ?? 0).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* 퍼지 패널 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">캐시 퍼지</h3>

        {/* 탭 */}
        <div className="flex border-b border-gray-200 mb-4">
          {(['url', 'domain', 'all'] as PurgeTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'url' ? 'URL 퍼지' : tab === 'domain' ? '도메인 퍼지' : '전체 퍼지'}
            </button>
          ))}
        </div>

        {activeTab === 'url' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://cdn.textbook.com/images/cover.png"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="url-input"
            />
            <button
              onClick={handlePurgeClick}
              disabled={isPurgeDisabled}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="purge-btn"
            >
              퍼지
            </button>
          </div>
        )}

        {activeTab === 'domain' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="cdn.textbook.com"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="domain-input"
            />
            <button
              onClick={handlePurgeClick}
              disabled={isPurgeDisabled}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="purge-btn"
            >
              퍼지
            </button>
          </div>
        )}

        {activeTab === 'all' && (
          <div>
            <p className="text-sm text-gray-500 mb-3">
              모든 캐시 항목({(stats?.entry_count ?? 0).toLocaleString()}건)을 삭제합니다.
            </p>
            <button
              onClick={handlePurgeClick}
              disabled={purge.isPending}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
              data-testid="purge-btn"
            >
              전체 퍼지
            </button>
          </div>
        )}
      </div>

      {/* 인기 콘텐츠 테이블 */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-sm font-medium text-gray-500 mb-3">인기 콘텐츠</h3>
        {!popular || popular.length === 0 ? (
          <p className="text-sm text-gray-400">캐시된 콘텐츠가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="pb-2 pr-4 font-medium">URL</th>
                  <th className="pb-2 pr-4 font-medium">크기</th>
                  <th className="pb-2 pr-4 font-medium">히트 수</th>
                  <th className="pb-2 font-medium">도메인</th>
                </tr>
              </thead>
              <tbody>
                {popular.map((item) => (
                  <tr key={item.url} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-mono text-gray-800 max-w-xs truncate">{item.url}</td>
                    <td className="py-2 pr-4 text-gray-600">{formatBytes(item.size_bytes)}</td>
                    <td className="py-2 pr-4 font-semibold">{item.hit_count.toLocaleString()}</td>
                    <td className="py-2 text-gray-500">{item.domain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
