/** 시스템 페이지 v3
 * Card·Skeleton 기반, 에러 상태 처리, formatUptime 공통 유틸 사용
 * 마이크로서비스 상태 그리드 + 장애 배너 추가
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { AlertTriangle, Monitor, Sun, Moon, CheckCircle2, XCircle } from 'lucide-react';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { useProxyStatus } from '../hooks/useProxyStatus';
import { useSystemStatus } from '../api/system';
import { ServiceStatusCard } from '../components/system/ServiceStatusCard';
import { useCacheStats } from '../hooks/useCacheStats';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { TlsStatusBadge } from '../components/TlsStatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { downloadCACert, downloadMobileConfig } from '../api/tls';
import { useCertificates } from '../hooks/useTls';
import { formatBytes, formatUptime } from '../lib/format';
import { LogViewer } from '../components/system/LogViewer';
import { DangerZoneCard } from '../components/system/DangerZoneCard';
import type { SystemStatus } from '../api/system';

/** 서비스 키 → 표시 레이블 매핑 (SystemStatus 타입과 동기화)
 * DNS·TLS는 전 세계 공통 기술 약어이므로 영문 유지,
 * Proxy·Storage·Optimizer는 한국어 표기가 표준화됨 */
const SERVICE_LABELS: Record<keyof SystemStatus, string> = {
  proxy: '프록시',
  storage: '스토리지',
  tls: 'TLS',        // 기술 약어 — 영문 유지
  dns: 'DNS',        // 기술 약어 — 영문 유지
  optimizer: '최적화기',
};


/** 인증서 검색 input·max-height 컨테이너 노출 임계 (#284)
 * 운영 환경에서 도메인이 늘어나면 인증서 행 수가 증가해 페이지가 무한히 길어지고
 * 하단 '테마 설정' 같은 다른 섹션의 발견성이 떨어진다. 임계 초과 시 검색·스크롤
 * 컨테이너로 페이지 높이를 일정하게 유지한다. 10건은 시드+소수 운영 도메인
 * 환경에서 모두 노출 유지하면서, 누적·중복 인증서가 쌓이는 시점에 대비한 값. */
const CERT_TABLE_PAGINATION_THRESHOLD = 10;

export function SystemPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme);
  // 인증서 검색어 — 도메인 부분 일치(대소문자 무시). 임계 초과 시에만 input 노출.
  // URL searchParam ?certQ=... 으로 동기화하여 새로고침/공유 링크/뒤로가기 시 검색어를 유지한다 (#301).
  // DnsPage(#292)·DomainsPage(#68) 검색 URL 동기화 패턴과 일관. SystemPage 다른 상태(테마 등)와
  // 충돌하지 않도록 'certQ' 라는 prefix가 붙은 키를 사용한다.
  const [searchParams, setSearchParams] = useSearchParams();
  const certSearchQuery = searchParams.get('certQ') ?? '';

  function handleThemeChange(theme: Theme) {
    setTheme(theme);
    setCurrentTheme(theme);
  }

  /** 인증서 검색어 변경 — ?certQ=<value>로 URL에 반영 (#301).
   *  - 빈 문자열일 때는 파라미터 제거 → URL 깔끔하게 유지 (DomainsPage·DnsPage 동일 정책)
   *  - 검색어 변경은 history 누적 대상이 아니므로 replace 사용 (탭/필터와 동일 정책) */
  const handleCertSearchChange = useCallback(
    (value: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (value) next.set('certQ', value);
          else next.delete('certQ');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // CA 인증서/iOS 프로파일 다운로드 mutation — 성공/실패 양쪽 토스트로 피드백 (#187, #214)
  // - 이전엔 anchor href click만 호출해 4xx/5xx 응답 시 silent 실패했다 (#187 → onError 추가).
  // - 그 후에도 success 시 인앱 안내가 없어 운영자가 다운로드 완료 여부를 확인할 단서가 없었다 (#214).
  //   브라우저별 다운로드 칩 위치/허가 정책이 달라 시각적 단서가 부족하므로 success 토스트로 다음 단계까지 안내한다.
  const caDownload = useMutation({
    mutationFn: downloadCACert,
    onSuccess: () =>
      toast.success('CA 인증서를 다운로드했습니다. 다운로드 폴더에서 확인하세요.'),
    onError: () => toast.error('CA 인증서 다운로드에 실패했습니다.'),
  });
  const mobileconfigDownload = useMutation({
    mutationFn: downloadMobileConfig,
    // iPad 설치 안내(우측 가이드)와 어조 일치 — 설정 앱에서 설치 단계로 이어지도록 명시
    onSuccess: () =>
      toast.success('iOS 프로파일을 다운로드했습니다. 설정 앱에서 설치를 계속하세요.'),
    onError: () => toast.error('iOS 프로파일 다운로드에 실패했습니다.'),
  });

  const { data: status, isLoading: statusLoading, error: statusError } = useProxyStatus();
  const { data: cache, isLoading: cacheLoading, error: cacheError } = useCacheStats();
  const { data: certificates, isLoading: certsLoading, error: certsError } = useCertificates();
  // 인증서 카드 정렬 (#210): 만료(과거) → 임박(가까운 만료) → 일반 순.
  // 운영자가 위험 상태 인증서를 한눈에 식별할 수 있도록 expires_at 오름차순으로 정렬한다.
  // expires_at 값이 없는 항목(방어적 처리)은 가장 하단으로 보낸다.
  const sortedCertificates = useMemo(() => {
    if (!certificates) return certificates;
    return [...certificates].sort((a, b) => {
      const ax = a.expires_at ? new Date(a.expires_at).getTime() : Number.POSITIVE_INFINITY;
      const bx = b.expires_at ? new Date(b.expires_at).getTime() : Number.POSITIVE_INFINITY;
      return ax - bx;
    });
  }, [certificates]);
  // 검색 input 노출 여부 — 임계(10건) 초과 시에만 노출해 적은 환경에서는 UI 단순 유지.
  const showCertSearch =
    !!sortedCertificates && sortedCertificates.length > CERT_TABLE_PAGINATION_THRESHOLD;
  // 검색어로 필터링된 인증서 목록 — 도메인 substring 매칭(대소문자 무시).
  // 검색어 공백 trim 후 빈 문자열이면 전체 노출. sortedCertificates 정렬 결과 위에 적용해
  // 만료/임박 우선 노출 정책을 유지한다.
  //
  // 임계(10건) 이하에서는 검색 input이 미노출이므로 필터도 적용하지 않는다(#422).
  // 그렇지 않으면 ?certQ=... 공유 링크로 진입 시 필터는 살아있지만 해제 UI가 없어
  // 사용자가 "검색 결과가 없습니다" 또는 일부 누락된 목록만 보게 되는 silent 필터 상태가 발생한다.
  // URL의 ?certQ= 파라미터 자체도 아래 useEffect에서 strip한다 (DomainsPage hasInvalidEnabled 패턴).
  const filteredCertificates = useMemo(() => {
    if (!sortedCertificates) return sortedCertificates;
    if (!showCertSearch) return sortedCertificates; // 검색 UI 미노출 시 필터 무력화 (#422)
    const q = certSearchQuery.trim().toLowerCase();
    if (!q) return sortedCertificates;
    return sortedCertificates.filter((c) => c.domain.toLowerCase().includes(q));
  }, [sortedCertificates, certSearchQuery, showCertSearch]);

  // 임계 이하에서 ?certQ= 파라미터가 URL에 남아있으면 strip — 검색 UI가 노출되지 않으므로
  // 해제 수단이 없어진 silent 필터 상태를 방지한다 (#422). 인증서가 늘어나 임계를 넘어가는
  // 시점에 다시 ?certQ= 가 의미를 갖도록, sortedCertificates 로드 후에만 동작한다.
  // DomainsPage hasInvalidEnabled useEffect와 동일하게 replace로 히스토리 오염 방지.
  useEffect(() => {
    if (!sortedCertificates) return; // 로딩/에러 중에는 URL 보존
    if (showCertSearch) return; // 임계 초과 — 검색 UI 노출되므로 ?certQ= 유효
    if (!searchParams.has('certQ')) return;
    const next = new URLSearchParams(searchParams);
    next.delete('certQ');
    setSearchParams(next, { replace: true });
  }, [sortedCertificates, showCertSearch, searchParams, setSearchParams]);
  // isLoading: 첫 요청이 완료되기 전 true — 로딩 중엔 Skeleton으로 대체해
  // systemStatus=undefined 시 ?? true fallback으로 오표시되는 버그(#139) 방지
  const { data: systemStatus, isLoading: systemStatusLoading } = useSystemStatus();

  // 하나라도 오프라인인 서비스가 있으면 장애 배너 표시
  // systemStatus가 없는 로딩 중엔 배너를 표시하지 않는다
  const anyOffline = systemStatus
    ? !systemStatus.proxy.online || !systemStatus.storage.online || !systemStatus.tls.online || !systemStatus.dns.online || !systemStatus.optimizer.online
    : false;

  // 캐시 재설계 후 disk 관련 필드는 `cache.disk.*`로 이동했다.
  const diskUsageRatio =
    cache && cache.disk.max_bytes > 0
      ? cache.disk.used_bytes / cache.disk.max_bytes
      : 0;
  // Math.floor + 99% 캡: 99.5%~99.99% 구간이 Math.round로 100%로 올림되어 "100% 사용 중"으로
  // misleading 표시되던 버그(#204) 방지. ratio가 정확히 1 이상일 때만(used >= max) 100% 표시한다.
  // Math.min(..., 100): used_bytes > max_bytes 이상 케이스(마이그레이션·설정 변경 등)에서
  // bar width가 100% 초과하여 컨테이너 밖으로 삐져나오는 overflow 방지 (#140)
  const diskUsagePercent =
    diskUsageRatio >= 1
      ? 100
      : Math.min(Math.floor(diskUsageRatio * 100), 99);
  const isDiskWarning = diskUsageRatio >= 0.9;

  // Dashboard StorageUsageCard와 단위 정책 통일 (#239): GB 고정 → formatBytes 적응형(B/KB/MB/GB).
  // 같은 캐시 통계 값을 두 페이지가 다른 단위로 표시해 운영자 혼선 발생하던 문제 제거.
  const diskUsedLabel = cache ? formatBytes(cache.disk.used_bytes) : '-';
  const diskMaxLabel = cache ? formatBytes(cache.disk.max_bytes) : '-';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">시스템</h2>
        <p className="text-sm text-muted-foreground mt-1">서비스 상태, 인증서, 디스크 사용량을 확인합니다.</p>
      </div>

      {/* 마이크로서비스 상태 그리드
       * 로딩 중: Skeleton 카드 5개 표시 — 실제 데이터 오기 전 온라인 오표시(#139) 방지
       * 로드 후: 실제 online/latency_ms 값 사용 (fallback ?? true 제거)
       * 그리드 분할: 카드 수가 5개로 고정이므로 3의 배수 그리드(3-col)는 항상 dangling 행 발생.
       *   → mobile 2-col(2+2+1), md(768px+) 5-col 단일 행으로 단순화하여 빈 슬롯 제거 (#269) */}
      <div
        data-testid="service-status-grid"
        className="grid grid-cols-2 gap-4 md:grid-cols-5"
      >
        {systemStatusLoading || !systemStatus ? (
          [...Array(5)].map((_, i) => (
            <Skeleton key={i} data-testid="service-status-skeleton" className="h-28 w-full rounded-xl" />
          ))
        ) : (
          (['proxy', 'storage', 'tls', 'dns', 'optimizer'] as const).map((key) => (
            <ServiceStatusCard
              key={key}
              name={SERVICE_LABELS[key]}
              online={systemStatus[key].online}
              latency_ms={systemStatus[key].latency_ms}
            />
          ))
        )}
      </div>

      {/* 실시간 로그 뷰어 */}
      <LogViewer />

      {/* 서비스 장애 배너 */}
      {anyOffline && (
        <div data-testid="service-offline-banner" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertTriangle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">일부 서비스가 오프라인입니다.</p>
            <p className="mt-1 text-sm">서비스 상태를 확인하세요.</p>
          </div>
        </div>
      )}

      {/* 디스크 사용량 경고 배너 */}
      {isDiskWarning && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <p className="font-semibold">캐시 디스크 사용량이 {diskUsagePercent}%입니다.</p>
          <p className="mt-1 text-sm">
            오래된 캐시를 퍼지하거나 최대 용량을 늘리세요.{' '}
            {/* /cache는 /domains로 리다이렉트되는 데드 링크 — 실제 캐시 퍼지가 있는 대시보드(/)로 안내 */}
            <Link to="/" className="underline">
              캐시 관리 페이지로 이동
            </Link>
          </p>
        </div>
      )}

      {/* 서버 업타임 */}
      <Card>
        <CardHeader><CardTitle>서버 업타임</CardTitle></CardHeader>
        <CardContent>
          {statusLoading ? (
            <Skeleton className="h-9 w-40" data-testid="uptime-loading" />
          ) : statusError ? (
            <p className="text-sm text-destructive">프록시에 연결할 수 없습니다.</p>
          ) : (
            <>
              <p data-testid="uptime-value" className="text-3xl font-bold">
                {status ? formatUptime(status.uptime) : '—'}
              </p>
              {/* 온/오프라인 상태 — lucide-react 아이콘으로 표시해 디자인 시스템 색상 토큰 적용 */}
              <p className="mt-1 flex items-center gap-1 text-sm">
                {status?.online ? (
                  <>
                    <CheckCircle2 size={14} className="text-success" />
                    <span className="text-success">온라인</span>
                  </>
                ) : (
                  <>
                    <XCircle size={14} className="text-destructive" />
                    <span className="text-destructive">오프라인</span>
                  </>
                )}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 캐시 디스크 사용량 */}
      <Card>
        <CardHeader><CardTitle>캐시 디스크 사용량</CardTitle></CardHeader>
        <CardContent>
          {cacheLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
            </div>
          ) : cacheError ? (
            <p className="text-sm text-destructive">캐시 정보를 불러오지 못했습니다.</p>
          ) : (
            <>
              <div className="mb-2 flex justify-between text-sm text-muted-foreground">
                <span>{diskUsedLabel} 사용</span>
                <span>{diskMaxLabel} 최대</span>
              </div>
              <div
                data-testid="disk-usage-bar"
                className="h-3 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    isDiskWarning ? 'bg-destructive' : 'bg-primary'
                  }`}
                  style={{ width: `${diskUsagePercent}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{diskUsagePercent}% 사용 중</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* CA 인증서 설치 */}
      <Card data-testid="ca-cert-card">
        <CardHeader><CardTitle>CA 인증서</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            iPad 또는 PC에 설치하면 HTTPS 콘텐츠를 캐싱합니다.
          </p>
          <div className="flex gap-3">
            <Button
              data-testid="ca-download-btn"
              variant="outline"
              onClick={() => caDownload.mutate()}
              disabled={caDownload.isPending}
            >
              {caDownload.isPending ? '다운로드 중...' : '.crt 다운로드'}
            </Button>
            <Button
              data-testid="mobileconfig-download-btn"
              variant="outline"
              onClick={() => mobileconfigDownload.mutate()}
              disabled={mobileconfigDownload.isPending}
            >
              {mobileconfigDownload.isPending ? '다운로드 중...' : 'iOS 프로파일 다운로드'}
            </Button>
          </div>
          <div className="rounded-md bg-accent p-3 text-sm text-accent-foreground">
            <p className="font-medium">iPad 설치 방법</p>
            <ol className="mt-1 list-decimal pl-4 space-y-1">
              <li>Safari에서 <strong>iOS 프로파일 다운로드</strong> 클릭</li>
              <li>설정 앱 → <em>프로파일이 다운로드됨</em> → 설치</li>
              <li>설정 → 일반 → 정보 → 인증서 신뢰 설정 → Smart School CDN CA 신뢰 활성화</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* 발급된 인증서 목록 (#284)
       * 33+ 인증서가 한 번에 노출되어 페이지 하단(테마 설정 등) 발견성이 낮아지는 문제 해결:
       * - 임계(10건) 초과 시: 도메인 검색 input 노출 + 테이블을 max-h 360px·overflow-y 컨테이너로 감싸 sticky 헤더 적용.
       * - 임계 이하: 기존처럼 단순 테이블 노출(과한 chrome 제거).
       * 정렬(만료/임박/일반) 정책은 그대로 유지하고, 그 위에 검색 필터를 얹는다. */}
      <Card data-testid="certificates-card">
        <CardHeader><CardTitle>발급된 인증서</CardTitle></CardHeader>
        <CardContent>
          {certsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : certsError ? (
            <p className="text-sm text-destructive">인증서 목록을 불러오지 못했습니다.</p>
          ) : !sortedCertificates || sortedCertificates.length === 0 ? (
            <p data-testid="certificates-empty" className="text-sm text-muted-foreground">
              아직 발급된 인증서가 없습니다. HTTPS 요청이 들어오면 자동으로 발급됩니다.
            </p>
          ) : (
            <div className="space-y-3">
              {showCertSearch && (
                <div className="flex items-center justify-between gap-3">
                  <Input
                    data-testid="certificates-search"
                    type="search"
                    placeholder="도메인 검색"
                    aria-label="인증서 도메인 검색"
                    value={certSearchQuery}
                    onChange={(e) => handleCertSearchChange(e.target.value)}
                    className="max-w-xs"
                  />
                  <p
                    data-testid="certificates-count"
                    className="shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {filteredCertificates?.length ?? 0} / {sortedCertificates.length}건
                  </p>
                </div>
              )}
              {/* 검색 결과가 0건인 경우 — 빈 안내(테이블 헤더만 외롭게 보이는 상태 방지) */}
              {filteredCertificates && filteredCertificates.length === 0 ? (
                <p
                  data-testid="certificates-search-empty"
                  className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  검색 결과가 없습니다.
                </p>
              ) : (
                <div
                  data-testid="certificates-table-scroll"
                  className={
                    // 임계 초과 시에만 max-height+overflow 적용해 페이지 높이 안정화.
                    // sticky 헤더(thead)가 컨테이너 상단에 붙어 도메인 컬럼 식별성 유지.
                    showCertSearch
                      ? 'max-h-[360px] overflow-y-auto rounded-md border border-border/60'
                      : ''
                  }
                >
                  <Table data-testid="certificates-table">
                    <TableHeader
                      className={
                        showCertSearch ? 'sticky top-0 z-10 bg-muted/95 backdrop-blur-sm' : ''
                      }
                    >
                      <TableRow>
                        <TableHead>도메인</TableHead>
                        <TableHead>발급일</TableHead>
                        <TableHead>만료일</TableHead>
                        <TableHead>상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCertificates!.map((cert) => (
                        <TableRow key={cert.domain}>
                          {/* 도메인 셀: 클릭 시 도메인 상세 페이지로 이동 — Link 래핑 */}
                          <TableCell className="font-mono">
                            <Link
                              to={`/domains/${encodeURIComponent(cert.domain)}`}
                              className="hover:underline"
                            >
                              {cert.domain}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(cert.issued_at).toLocaleDateString('ko-KR')}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(cert.expires_at).toLocaleDateString('ko-KR')}
                          </TableCell>
                          <TableCell><TlsStatusBadge expiresAt={cert.expires_at} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {/* 위험 구역 — 전체 캐시 퍼지 (이슈 #282 — DashboardPage 에서 이동).
       *  파괴적 전역 액션이라 읽기 전용 대시보드가 아닌 유지보수 영역에 둔다. */}
      <DangerZoneCard />

      {/* 테마 설정 */}
      <Card>
        <CardHeader>
          <CardTitle>테마 설정</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {([
              { value: 'system' as const, icon: Monitor, label: '시스템' },
              { value: 'light' as const, icon: Sun, label: '라이트' },
              { value: 'dark' as const, icon: Moon, label: '다크' },
            ]).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => handleThemeChange(value)}
                aria-pressed={currentTheme === value}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  currentTheme === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
