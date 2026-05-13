/// 도메인 상세 — URL 진단 탭 (#387)
/// host context + path(+선택적 ?query) 입력 + 기간 selector 로 단일 URL 진단을 조회.
/// 결과: 상단 요약 한 줄 + 3분할(CDN/Origin/캐시 사본) + 응답 헤더 + Range 분포 + Refresh.
/// URL searchParams 와 양방향 동기화 (?path, ?dgRange).
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useDomainDiagnose } from '../../../hooks/useDomainDiagnose';
import { usePurgeCache } from '../../../hooks/usePurgeCache';
import type {
  DiagnoseRange,
  DomainDiagnoseResponse,
  DiagnoseCdn,
  DiagnoseOrigin,
  DiagnoseCacheCopy,
  DiagnoseRangeDist,
} from '../../../api/diagnose';
import { formatBytes } from '../../../lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
} from '../../ui/alert-dialog';

const RANGES: DiagnoseRange[] = ['1h', '24h', '7d'];

interface Props {
  host: string;
}

/** path 입력에 `?query` 가 포함되어 있으면 분리한다 — admin-server 가 별도 파라미터를 요구 */
function splitPathAndQuery(input: string): { path: string; query: string } {
  const i = input.indexOf('?');
  if (i < 0) return { path: input, query: '' };
  return { path: input.slice(0, i), query: input.slice(i + 1) };
}

export function DomainDiagnoseTab({ host }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL searchParams 와 양방향 동기화 — 진단 path/기간을 북마크·공유 링크로 복원
  const [pathInput, setPathInput] = useState(searchParams.get('path') ?? '');
  const initialRange = searchParams.get('dgRange');
  const [range, setRange] = useState<DiagnoseRange>(
    RANGES.includes(initialRange as DiagnoseRange) ? (initialRange as DiagnoseRange) : '1h',
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Refresh 다이얼로그가 열릴 때 대상 URL을 snapshot으로 고정 (#398)
  // — 다이얼로그가 열려있는 동안 path 입력이 바뀌어도 confirm 시 처음 본 URL만 퍼지하기 위함.
  // null이면 다이얼로그 비활성 상태.
  const [pendingPurgeUrl, setPendingPurgeUrl] = useState<string | null>(null);

  const { path: pathOnly, query: queryOnly } = splitPathAndQuery(pathInput.trim());

  // path 형식 오류 감지 — 사용자가 무언가를 입력했지만 `/` 로 시작하지 않을 때 (#394)
  // useDomainDiagnose 는 이 조건에서 enabled=false 라 조용히 비활성되므로,
  // UI 단에서 사용자에게 명시적인 검증 메시지를 노출해 무피드백 상태를 제거한다.
  const pathInvalid = pathInput.trim().length > 0 && !pathOnly.startsWith('/');

  const diagnoseQuery = useDomainDiagnose({ host, path: pathOnly, query: queryOnly, range });
  const purgeMutation = usePurgeCache();

  // 진단 API 에러(500/네트워크 등) 시 toast로 1회 알림 — 무피드백 문제 해소 (#399).
  // 401은 글로벌 axios 인터셉터(src/lib/api.ts)가 /login 리다이렉트 처리하므로 별도 처리 불필요.
  // diagnoseQuery.error 가 새 에러 인스턴스로 바뀔 때마다 한 번만 알림.
  useEffect(() => {
    if (diagnoseQuery.isError) {
      toast.error('진단 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, [diagnoseQuery.isError, diagnoseQuery.error]);

  // URL state 동기화 — path/dgRange 변경 시 ?path=&dgRange= 반영 (replace로 히스토리 누적 방지)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'diagnose');
    if (pathInput.trim()) next.set('path', pathInput.trim()); else next.delete('path');
    next.set('dgRange', range);
    setSearchParams(next, { replace: true });
    // pathInput, range 변경 시에만 — searchParams/setSearchParams 자체는 의존성에서 제외 (lint 무시)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathInput, range]);

  const data = diagnoseQuery.data;
  const refreshDisabled =
    !pathOnly.startsWith('/') || data?.cache_copy?.exists !== true || purgeMutation.isPending;

  /** 대상 full URL 빌더 — host + path + (선택적) ?query */
  const buildFullUrl = useCallback(
    (p: string, q: string) => `https://${host}${p}${q ? `?${q}` : ''}`,
    [host],
  );

  /** Refresh 버튼 클릭 → 현재 입력을 snapshot으로 고정한 뒤 다이얼로그 오픈 (#398) */
  const onOpenRefresh = useCallback(() => {
    setPendingPurgeUrl(buildFullUrl(pathOnly, queryOnly));
    setConfirmOpen(true);
  }, [buildFullUrl, pathOnly, queryOnly]);

  /** Refresh 확인 → snapshot URL 로 PURGE 호출 → 진단 데이터 자동 refetch
   *  다이얼로그 오픈 이후 path 입력이 바뀌어도 처음 사용자가 본 URL만 퍼지한다 (#398) */
  const onConfirmRefresh = useCallback(async () => {
    const target = pendingPurgeUrl;
    setConfirmOpen(false);
    if (!target) return;
    try {
      await purgeMutation.mutateAsync({ type: 'url', target });
      toast.success('캐시 사본을 비웠습니다. 다음 요청 시 origin에서 다시 가져옵니다.');
      await diagnoseQuery.refetch();
    } catch {
      toast.error('캐시 퍼지에 실패했습니다.');
    } finally {
      setPendingPurgeUrl(null);
    }
  }, [pendingPurgeUrl, purgeMutation, diagnoseQuery]);

  return (
    <div className="space-y-4">
      {/* 입력 영역 */}
      <Card data-testid="domain-diagnose-input">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">진단할 URL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="md:w-40">
              <Label className="text-xs text-muted-foreground">host</Label>
              <div className="font-mono text-sm h-9 flex items-center">{host}</div>
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">
                path (?query 포함 가능, `/` 시작)
              </Label>
              <Input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="/ch2/n-unit/video.mp4"
                className="h-9 text-sm"
                data-testid="diagnose-path-input"
                aria-invalid={pathInvalid || undefined}
                aria-describedby={pathInvalid ? 'diagnose-path-error' : undefined}
              />
              {/* path 검증 메시지 — `/` 누락 시 조용히 비활성되는 무피드백 문제 해소 (#394) */}
              {pathInvalid && (
                <p
                  id="diagnose-path-error"
                  className="mt-1 text-xs text-destructive"
                  data-testid="diagnose-path-error"
                >
                  path는 `/` 로 시작해야 합니다. 예: /ch2/n-unit/video.mp4
                </p>
              )}
            </div>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <Button
                  key={r}
                  variant={r === range ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRange(r)}
                  data-testid={`diagnose-range-${r}`}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 요약 한 줄 / 로딩 / 에러 상태 — SummaryLine 자리에서 query 상태를 사용자에게 노출 (#399).
          - 로딩 중: '진단 중...'
          - 실패: 에러 메시지 + 다시 시도 버튼 (refetch)
          - 성공: 기존 SummaryLine */}
      {diagnoseQuery.isError ? (
        <div
          className="flex items-center gap-2 text-sm text-destructive"
          data-testid="diagnose-error"
          role="alert"
        >
          <span>진단 조회 실패 — 잠시 후 다시 시도해 주세요.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => diagnoseQuery.refetch()}
            disabled={diagnoseQuery.isFetching}
            data-testid="diagnose-error-retry-btn"
          >
            다시 시도
          </Button>
        </div>
      ) : diagnoseQuery.isFetching && !data ? (
        <div
          className="text-sm text-muted-foreground"
          data-testid="diagnose-loading"
          aria-live="polite"
        >
          진단 중...
        </div>
      ) : (
        data && <SummaryLine data={data} />
      )}

      {/* 3분할 패널 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CdnPanel cdn={data?.cdn ?? null} hitRatio={data?.hit_ratio_pct ?? null} />
        <OriginPanel origin={data?.origin ?? null} />
        <CacheCopyPanel copy={data?.cache_copy ?? null} />
      </div>

      {/* 응답 헤더 + Range 카드 */}
      <HeadersCard headers={data?.response_headers ?? null} />
      <RangeCard range={data?.range ?? null} />

      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={refreshDisabled}
          onClick={onOpenRefresh}
          data-testid="diagnose-refresh-btn"
        >
          Refresh from origin
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        iPad·교실 Wi-Fi·DHCP 측은 본 진단 범위 밖. CDN·origin 모두 정상이면 클라이언트 측 점검을
        권장합니다.
      </p>

      {/* Refresh 확인 다이얼로그 — pending 중 ESC/백드롭 닫기 차단
          대상 URL은 다이얼로그 오픈 시점 snapshot(pendingPurgeUrl)을 명시 표시한다 (#398) */}
      <AlertDialog
        open={confirmOpen}
        onClose={() => {
          if (!purgeMutation.isPending) {
            setConfirmOpen(false);
            setPendingPurgeUrl(null);
          }
        }}
      >
        <AlertDialogContent
          className="max-w-sm"
          disableClose={purgeMutation.isPending}
          data-testid="diagnose-refresh-dialog"
        >
          <AlertDialogTitle>이 URL의 캐시를 비웁니다</AlertDialogTitle>
          {/* 사용자가 어떤 URL이 퍼지되는지 명확히 인지하도록 snapshot URL을 본문에 노출 (#398).
              다이얼로그 열린 동안 path 입력이 바뀌어도 이 값은 변하지 않는다. */}
          {pendingPurgeUrl && (
            <p
              className="font-mono text-xs break-all rounded bg-muted px-2 py-1"
              data-testid="diagnose-refresh-target-url"
            >
              {pendingPurgeUrl}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            다음 요청 시 origin 에서 다시 가져옵니다. 계속할까요?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                setPendingPurgeUrl(null);
              }}
              disabled={purgeMutation.isPending}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirmRefresh}
              disabled={purgeMutation.isPending}
              data-testid="diagnose-refresh-confirm-btn"
            >
              비우기
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── 표시값 정규화 헬퍼 ────────────────────────────────────────

/** epoch seconds 를 사람이 읽는 시각 문자열로 변환한다 (#401).
 *  - 0/음수/NaN/Infinity 는 "미상" 또는 호출부가 지정한 fallback 으로 처리한다
 *  - 기존엔 stored_at=0 → "1970. 1. 1. 오전 9:00:00" 로 표시되어 사용자가
 *    "1970년에 캐싱됨" 으로 오해할 수 있었음 (실제로는 "값 없음" 의 의미). */
function formatEpochSeconds(seconds: number | null | undefined, fallback = '—'): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  return new Date(seconds * 1000).toLocaleString();
}

/** hit ratio(%) 표시 정규화 (#401).
 *  - 비정상값(NaN/Infinity/null) 은 "—"
 *  - 0~100 범위로 클램핑해 101% 같은 모순값 차단 (서버 버그/race 방어)
 *  - 소수 1자리 고정 — 100.4567% 처럼 무제한 소수 표시 방지. */
function formatHitRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const clamped = Math.min(100, Math.max(0, value));
  return `${clamped.toFixed(1)}%`;
}

// ── 하위 컴포넌트 ─────────────────────────────────────────────

/** 진단 결과 요약 — CDN 상태 · origin 상태 · 캐시 사본 유무를 한 줄로 표시 */
/** 진단 결과 요약 — CDN 상태 · origin 상태 · 캐시 사본 유무를 한 줄로 표시.
 *
 *  부분 실패(null) vs 정상-부재 구분 (#400):
 *  서버는 storage RPC 등 부분 실패 시 cache_copy/response_headers 를 `null` 로 두고 200을 유지.
 *  과거에는 null 과 `exists:false` 를 같은 "캐시 사본 없음" 으로 합쳐 사용자가 구분 불가했음.
 *  → null 인 경우 명시적으로 "캐시 사본 조회 실패" 로 분기 표시. */
function SummaryLine({ data }: { data: DomainDiagnoseResponse }) {
  const cdn = data.cdn
    ? `CDN ${data.cdn.current_state}${data.cdn.layer !== 'none' ? `(${data.cdn.layer})` : ''}`
    : 'CDN 알 수 없음';
  const origin =
    data.origin.status === null
      ? 'origin 데이터 없음'
      : `origin ${data.origin.status === 'ok' ? '정상' : data.origin.status}`;
  // cache_copy === null (부분 실패) vs exists:false (정상 부재) 명시적 구분 (#400)
  let cache: string;
  if (data.cache_copy === null) {
    cache = '캐시 사본 조회 실패';
  } else if (data.cache_copy.exists) {
    // expires_at 정규화 — 0/음수/NaN/Infinity 는 "없음" (#401)
    cache = `캐시 사본 보유 (만료 ${formatEpochSeconds(data.cache_copy.expires_at, '없음')})`;
  } else {
    cache = '캐시 사본 없음';
  }
  return (
    <div className="text-sm" data-testid="diagnose-summary">
      {cdn} · {origin} · {cache}
    </div>
  );
}

/** CDN 패널 — 현재 상태(HIT/MISS/BYPASS), 레이어, 기간 내 hit ratio */
/** CDN 패널 — 현재 상태(HIT/MISS/BYPASS), 레이어, 기간 내 hit ratio.
 *
 *  cdn === null (proxy /diagnose 응답 실패) 시 별도 안내 (#400):
 *  서버는 proxy 가 응답하지 않을 때 cdn 을 null 로 두고 200을 유지. UI 가 "데이터 없음" 으로
 *  같이 표시하면 사용자가 부분 실패와 정상 부재를 구분 못함. */
function CdnPanel({ cdn, hitRatio }: { cdn: DiagnoseCdn | null; hitRatio: number | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">CDN</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {cdn === null && (
          // proxy 에서 진단 응답을 받지 못함 — 부분 실패 명시 (#400)
          <div className="text-muted-foreground" data-testid="diagnose-cdn-error">
            proxy 진단 응답을 받지 못했습니다
          </div>
        )}
        <div>
          현재 상태: <strong>{cdn?.current_state ?? '—'}</strong>
        </div>
        {/* layer='none' 은 BYPASS 등 "레이어 개념이 의미 없는 상태"를 의미.
            SummaryLine 과 표시를 통일해 'none' 일 때는 '—' 로 표기 (#397). */}
        <div>레이어: {!cdn || cdn.layer === 'none' ? '—' : cdn.layer}</div>
        <div>기간 내 hit ratio: {formatHitRatio(hitRatio)}</div>
      </CardContent>
    </Card>
  );
}

/** Origin 패널 — 상태, 평균 RTT, 5xx/timeout 카운트, 샘플 수.
 *
 *  sample_count === 0 일 때의 sanity 가드 (#401):
 *  표본이 0건이면 5xx/timeout/avg_rtt 카운트는 통계적으로 무의미하다.
 *  서버가 모순된 값(sample=0 + 5xx=42)을 보내더라도 UI 단에서 "샘플 없음" 한 줄로
 *  합치고 카운트들은 "—" 로 표시해 사용자 오해를 차단한다. */
function OriginPanel({ origin }: { origin: DiagnoseOrigin | null }) {
  // 표본이 0/null 인 경우 — 카운트 패널은 의미 없는 데이터로 간주
  const noSamples = !origin || !origin.sample_count || origin.sample_count <= 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Origin</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1" data-testid="diagnose-origin-panel">
        <div>
          상태: <strong>{origin?.status ?? '—'}</strong>
        </div>
        {noSamples ? (
          // sample_count=0 일 때는 모순된 카운트(5xx/timeout) 노출 차단 (#401)
          <div className="text-muted-foreground" data-testid="diagnose-origin-no-samples">
            샘플 없음 — 카운트 표시 불가
          </div>
        ) : (
          <>
            <div>평균 RTT: {origin.avg_rtt_ms == null ? '—' : `${origin.avg_rtt_ms} ms`}</div>
            <div>
              5xx: {origin.error_5xx ?? '—'} · timeout: {origin.timeout_count ?? '—'}
            </div>
            <div>샘플: {origin.sample_count}</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 캐시 사본 패널 — 파일 크기, 저장 시각, 만료 시각 */
/** 캐시 사본 패널 — 파일 크기, 저장 시각, 만료 시각.
 *
 *  null (부분 실패) vs `exists:false` (정상 부재) 구분 (#400):
 *  null 인 경우 storage RPC 실패 등 "조회 자체가 실패" 했음을 사용자에게 명시. */
function CacheCopyPanel({ copy }: { copy: DiagnoseCacheCopy | null }) {
  // null/false 를 동일 처리하지 않도록 분기 — 정상 부재는 "—", 조회 실패는 안내 메시지 (#400)
  const showError = copy === null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">캐시 사본</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {copy?.exists ? (
          <>
            {/* size_bytes 자동 스케일링(B/KB/MB/GB) — 다른 패널과 단위 정책 통일 (#395) */}
            {/* size_bytes 자동 스케일링(B/KB/MB/GB) — 다른 패널과 단위 정책 통일 (#395).
                formatBytes 가 음수/NaN/Infinity 를 "—" 로 가드함 (#401). */}
            <div>{formatBytes(copy.size_bytes)}</div>
            {/* stored_at 도 expires_at 과 동일한 정책 적용 — epoch 0/음수/NaN 은 "—" (#401).
                기존엔 stored_at=0 일 때 "1970-01-01 09:00" 가 표시되어 사용자 오해 유발. */}
            <div>저장: {formatEpochSeconds(copy.stored_at)}</div>
            <div>만료: {formatEpochSeconds(copy.expires_at, '없음')}</div>
          </>
        ) : showError ? (
          <div className="text-muted-foreground" data-testid="diagnose-cache-copy-error">
            조회 실패 (storage 응답 없음)
          </div>
        ) : (
          <div>—</div>
        )}
      </CardContent>
    </Card>
  );
}

/** 응답 헤더 카드 — name/value 쌍을 dl 그리드로 표시 */
/** 응답 헤더 카드 — name/value 쌍을 dl 그리드로 표시.
 *
 *  null (부분 실패) vs [] (정상 부재) 구분 (#400):
 *  null 은 storage RPC 실패 등 "조회 실패" 상태이므로 빈 배열과 달리 명시적 안내를 표시. */
function HeadersCard({
  headers,
}: {
  headers: Array<{ name: string; value: string }> | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">응답 헤더</CardTitle>
      </CardHeader>
      <CardContent>
        {headers === null ? (
          // 부분 실패 — 빈 배열과 구분되는 명시적 메시지 (#400)
          <div className="text-sm text-muted-foreground" data-testid="diagnose-headers-error">
            조회 실패 (storage 응답 없음)
          </div>
        ) : headers.length === 0 ? (
          <div className="text-sm text-muted-foreground">—</div>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {headers.map((h, idx) => (
              <div key={`${h.name}-${idx}`} className="contents">
                <dt className="font-mono text-muted-foreground">{h.name}</dt>
                <dd className="font-mono break-all">{h.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** Range 응답 분포 카드 — single / multi / none 카운트 */
function RangeCard({ range }: { range: DiagnoseRangeDist | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Range 응답 분포</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        single-range: {range?.single_count ?? '—'} · multi: {range?.multi_count ?? '—'} · none:{' '}
        {range?.none_count ?? '—'}
      </CardContent>
    </Card>
  );
}
