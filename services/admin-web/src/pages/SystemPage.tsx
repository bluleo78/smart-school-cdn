/** 시스템 페이지 v3
 * Card·Skeleton 기반, 에러 상태 처리, formatUptime 공통 유틸 사용
 * 마이크로서비스 상태 그리드 + 장애 배너 추가
 */
import { useState } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { downloadCACert, downloadMobileConfig } from '../api/tls';
import { useCertificates } from '../hooks/useTls';
import { formatUptime } from '../lib/format';
import { LogViewer } from '../components/system/LogViewer';
import type { SystemStatus } from '../api/system';

/** 서비스 키 → 표시 레이블 매핑 (SystemStatus 타입과 동기화) */
const SERVICE_LABELS: Record<keyof SystemStatus, string> = {
  proxy: 'Proxy',
  storage: 'Storage',
  tls: 'TLS',
  dns: 'DNS',
  optimizer: 'Optimizer',
};


export function SystemPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme);

  function handleThemeChange(theme: Theme) {
    setTheme(theme);
    setCurrentTheme(theme);
  }

  const { data: status, isLoading: statusLoading, error: statusError } = useProxyStatus();
  const { data: cache, isLoading: cacheLoading, error: cacheError } = useCacheStats();
  const { data: certificates, isLoading: certsLoading, error: certsError } = useCertificates();
  const { data: systemStatus } = useSystemStatus();

  // 하나라도 오프라인인 서비스가 있으면 장애 배너 표시
  const anyOffline = systemStatus
    ? !systemStatus.proxy.online || !systemStatus.storage.online || !systemStatus.tls.online || !systemStatus.dns.online || !systemStatus.optimizer.online
    : false;

  // 캐시 재설계 후 disk 관련 필드는 `cache.disk.*`로 이동했다.
  const diskUsageRatio =
    cache && cache.disk.max_bytes > 0
      ? cache.disk.used_bytes / cache.disk.max_bytes
      : 0;
  const diskUsagePercent = Math.round(diskUsageRatio * 100);
  const isDiskWarning = diskUsageRatio >= 0.9;

  const diskUsedGB = cache ? (cache.disk.used_bytes / 1024 ** 3).toFixed(1) : '-';
  const diskMaxGB = cache ? (cache.disk.max_bytes / 1024 ** 3).toFixed(1) : '-';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">시스템</h2>
        <p className="text-sm text-muted-foreground mt-1">서비스 상태, 인증서, 디스크 사용량을 확인합니다.</p>
      </div>

      {/* 마이크로서비스 상태 그리드 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {(['proxy', 'storage', 'tls', 'dns', 'optimizer'] as const).map((key) => (
          <ServiceStatusCard
            key={key}
            name={SERVICE_LABELS[key]}
            online={systemStatus?.[key]?.online ?? true}
            latency_ms={systemStatus?.[key]?.latency_ms ?? 0}
          />
        ))}
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
            <Link to="/cache" className="underline">
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
                <span>{diskUsedGB} GB 사용</span>
                <span>{diskMaxGB} GB 최대</span>
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
              onClick={downloadCACert}
            >
              .crt 다운로드
            </Button>
            <Button
              data-testid="mobileconfig-download-btn"
              variant="outline"
              onClick={downloadMobileConfig}
            >
              iOS 프로파일 다운로드
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

      {/* 발급된 인증서 목록 */}
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
          ) : !certificates || certificates.length === 0 ? (
            <p data-testid="certificates-empty" className="text-sm text-muted-foreground">
              아직 발급된 인증서가 없습니다. HTTPS 요청이 들어오면 자동으로 발급됩니다.
            </p>
          ) : (
            <Table data-testid="certificates-table">
              <TableHeader>
                <TableRow>
                  <TableHead>도메인</TableHead>
                  <TableHead>발급일</TableHead>
                  <TableHead>만료일</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certificates.map((cert) => (
                  <TableRow key={cert.domain}>
                    <TableCell className="font-mono">{cert.domain}</TableCell>
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
          )}
        </CardContent>
      </Card>
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
