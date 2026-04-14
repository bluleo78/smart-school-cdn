/** 실시간 로그 뷰어 — 서비스 선택, 레벨 필터, 자동 스크롤 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useLogStream, type LogLine } from '../../hooks/useLogStream';

/** 서비스 옵션 목록 */
const SERVICES = [
  { value: 'proxy', label: 'Proxy' },
  { value: 'storage', label: 'Storage' },
  { value: 'tls', label: 'TLS' },
  { value: 'dns', label: 'DNS' },
  { value: 'optimizer', label: 'Optimizer' },
  { value: 'admin', label: 'Admin' },
] as const;

/** 레벨 필터 옵션 */
const LEVELS = ['all', 'ERROR', 'WARN', 'INFO', 'DEBUG'] as const;

/** 레벨별 Badge 색상 매핑 */
function levelBadge(level: LogLine['level']) {
  switch (level) {
    case 'ERROR':
      return (
        <Badge variant="destructive" className="text-xs font-mono shrink-0">
          ERR
        </Badge>
      );
    case 'WARN':
      return (
        <Badge variant="outline" className="border-amber-400 text-amber-700 text-xs font-mono shrink-0">
          WRN
        </Badge>
      );
    case 'DEBUG':
      return (
        <Badge variant="outline" className="border-gray-400 text-gray-500 text-xs font-mono shrink-0">
          DBG
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-xs font-mono shrink-0">
          INF
        </Badge>
      );
  }
}

/** 타임스탬프를 HH:MM:SS 형식으로 포맷 */
function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('ko-KR', { hour12: false });
  } catch {
    return ts.slice(11, 19);
  }
}

export function LogViewer() {
  const [service, setService] = useState('proxy');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { lines, isConnected, error, clear } = useLogStream(service);

  /** 레벨 필터 적용 — 클라이언트 사이드 */
  const filteredLines = levelFilter === 'all'
    ? lines
    : lines.filter((l) => l.level === levelFilter);

  /** 자동 스크롤: 새 로그 줄 추가 시 맨 아래로 */
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLines.length, autoScroll]);

  /** 스크롤 이벤트 핸들러 — 사용자가 위로 스크롤하면 자동 비활성화, 맨 아래 도달 시 재활성화 */
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 30;
    setAutoScroll(atBottom);
  }, []);

  return (
    <Card data-testid="log-viewer">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>서비스 로그</CardTitle>
            {isConnected ? (
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" data-testid="log-connected" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" data-testid="log-disconnected" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="w-[130px]" data-testid="log-service-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[100px]" data-testid="log-level-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l === 'all' ? '전체' : l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={autoScroll ? 'default' : 'outline'}
              className="text-xs px-3 py-1.5"
              onClick={() => setAutoScroll((v) => !v)}
              data-testid="log-autoscroll-btn"
            >
              {autoScroll ? '자동 스크롤 ON' : '자동 스크롤 OFF'}
            </Button>

            <Button
              variant="outline"
              className="text-xs px-3 py-1.5"
              onClick={clear}
              data-testid="log-clear-btn"
            >
              지우기
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <p className="text-sm text-destructive mb-2" data-testid="log-error">
            {error}
          </p>
        )}

        <ScrollArea className="h-[400px] rounded-md border bg-muted/30">
          <div
            ref={scrollRef}
            className="h-[400px] overflow-y-auto p-3 font-mono text-xs leading-relaxed"
            onScroll={handleScroll}
            data-testid="log-scroll-area"
          >
            {filteredLines.length === 0 ? (
              <p className="text-muted-foreground text-center py-8" data-testid="log-empty">
                {isConnected ? '로그를 수신 중입니다...' : '연결 대기 중...'}
              </p>
            ) : (
              filteredLines.map((line, i) => (
                <div key={`${line.timestamp}-${i}`} className="flex gap-2 py-0.5 hover:bg-muted/50">
                  <span className="text-muted-foreground shrink-0">{formatTime(line.timestamp)}</span>
                  {levelBadge(line.level)}
                  <span className="break-all">{line.message}</span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <span>{filteredLines.length}줄 표시 (총 {lines.length}줄)</span>
          <span>{isConnected ? '● 연결됨' : '○ 연결 끊김'}</span>
        </div>
      </CardContent>
    </Card>
  );
}
