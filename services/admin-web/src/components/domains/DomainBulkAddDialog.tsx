/// 도메인 일괄 추가 다이얼로그 — "host origin" 형식 텍스트 파싱
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { useBulkAddDomains } from '../../hooks/useBulkAddDomains';

interface DomainBulkAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 일괄 추가 입력 가드 상한 (#255)
 * - MAX_INPUT_CHARS: textarea `maxLength`로 강제하는 총 글자 수 한도(64KB).
 *   사용자가 실수로 거대한 텍스트(예: 40,000줄, 1.4MB)를 붙여넣어도 입력 단계에서 hard cap 되어
 *   Fastify body-limit(1MB) 초과로 인한 413 / admin-server 트랜잭션 장기 점유를 사전 차단한다.
 * - MAX_LINES: 한 번에 등록 가능한 줄 수 상한. 빈 줄 포함 전체 줄 수 기준으로 검사한다.
 *   서버 `/api/domains/bulk` 가드(domains.length ≤ MAX_LINES)와 일치시켜 직접 API 호출 시에도
 *   동일하게 거부되도록 한다.
 */
export const BULK_ADD_MAX_INPUT_CHARS = 65536;
export const BULK_ADD_MAX_LINES = 500;

export function DomainBulkAddDialog({ open, onOpenChange }: DomainBulkAddDialogProps) {
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const bulkAdd = useBulkAddDomains();

  /**
   * 입력 미리보기 — 큰 입력(예: 1000줄)을 붙여넣었을 때 사용자가 등록 예정 개수를 즉시 인지할 수 있게 한다 (#219).
   * - 줄 수: 빈 줄 포함 전체 줄 수 (사용자가 텍스트 양을 가늠하는 일차 지표)
   * - 도메인 개수: 공백 trim 후 비어있지 않은 줄만 카운트 (실제 등록 시도 대상에 가까움)
   * 파싱 단계에서 형식 검증을 하므로 여기서는 단순 카운트만 — 제출 버튼/textarea 라벨에 표시.
   */
  const totalLines = text === '' ? 0 : text.split('\n').length;
  const domainCount = text.split('\n').filter((l) => l.trim().length > 0).length;
  // (#255) 줄 수 상한 초과 시 미리보기/버튼 disabled 동기화 — 클릭 후 에러를 띄우는 것보다 즉각적 피드백 제공
  const overLineLimit = totalLines > BULK_ADD_MAX_LINES;

  /** 각 줄을 공백으로 split하여 { host, origin } 파싱 */
  function parseLines(): Array<{ host: string; origin: string }> | null {
    // 줄 수 상한 가드 (#255) — 빈 줄 포함 전체 줄 수가 한도를 넘으면 파싱 진입 전에 거부.
    // 거대한 입력(예: 40,000줄)이 그대로 통과해 미리보기/제출 버튼이 활성화되는 것을 차단한다.
    const totalLinesAtParse = text === '' ? 0 : text.split('\n').length;
    if (totalLinesAtParse > BULK_ADD_MAX_LINES) {
      setParseError(
        `한 번에 입력할 수 있는 줄 수는 최대 ${BULK_ADD_MAX_LINES}줄입니다 (현재 ${totalLinesAtParse}줄). 나누어 등록해 주세요.`,
      );
      return null;
    }

    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const result: Array<{ host: string; origin: string }> = [];
    // 동일 host 중복 줄 사전 감지용 — 첫 등장 줄 번호를 기록해 두 번째 줄에서 명시적 차단 (#225)
    // 같은 요청 안에서 host가 중복되면 서버 ON CONFLICT 로직이 첫 줄을 INSERT 후 두 번째 줄을
    // "이미 존재함"으로 분류해 사용자가 사전 등록한 적 없는데도 잘못된 안내가 나간다.
    // dedupe(첫 줄 채택)은 두 번째 origin 의도를 무시하므로, 사용자가 직접 어떤 origin을
    // 남길지 결정하도록 강제한다.
    const seenHostLine = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(/\s+/);
      if (parts.length < 2) {
        setParseError(`잘못된 형식: "${line}" — "host origin" 형식으로 입력해주세요.`);
        return null;
      }
      // 3번째 이상 토큰 silent drop 방지 (#178)
      // host/origin 외 추가 토큰이 있으면 사용자가 의도한 입력과 다르게 등록될 위험이 있어 명시적으로 차단한다.
      if (parts.length > 2) {
        setParseError(
          `잘못된 형식: "${line}" — 한 줄에는 host와 origin 두 값만 입력해주세요 (공백으로 구분).`,
        );
        return null;
      }
      // origin URL scheme 검증 — http:// 또는 https://만 허용
      // javascript:, file://, ftp:// 등 비정상 scheme이 DB에 저장되는 것을 방지한다 (#42)
      const origin = parts[1];
      if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
        setParseError(`잘못된 origin: "${line}" — http:// 또는 https://로 시작해야 합니다.`);
        return null;
      }
      // host 정규화 — DNS 호스트네임은 case-insensitive (RFC 1035 §2.3.3) 이고 서버도 lowercase
      // 로 통일 저장하므로(#201), 클라이언트도 입력 시 lowercase 로 통일해 동일 도메인이 대소문자
      // 차이만으로 별도 행처럼 보이지 않도록 한다.
      const host = parts[0].toLowerCase();
      // 동일 host 중복 차단 (#225) — 두 번째 origin 의도가 손실되지 않도록 사용자에게 직접 정정 요구
      const prevLineIndex = seenHostLine.get(host);
      if (prevLineIndex !== undefined) {
        setParseError(
          `중복된 host: ${host} (${i + 1}번째 줄, 이미 ${prevLineIndex + 1}번째 줄에 입력됨). ` +
            `한 번에는 같은 host를 한 번만 입력해 주세요.`,
        );
        return null;
      }
      seenHostLine.set(host, i);
      result.push({ host, origin });
    }
    return result;
  }

  async function handleSubmit() {
    setParseError(null);
    const domains = parseLines();
    // parseLines()가 null을 반환한 경우 이미 내부에서 setParseError 호출됨 — 덮어쓰지 않고 그냥 리턴
    if (domains === null) return;
    if (domains.length === 0) {
      setParseError('추가할 도메인을 입력해주세요.');
      return;
    }
    try {
      await bulkAdd.mutateAsync({ domains });
      // 성공 시에도 입력값/에러 잔존 방지 (#170)
      setText('');
      setParseError(null);
      onOpenChange(false);
    } catch {
      // 오류 토스트는 훅에서 처리
    }
  }

  /**
   * mutation 진행 중에는 닫기 요청(ESC/백드롭/X/취소)을 모두 무시한다 (#170, #163 패턴).
   * 외부 Wrapper 컴포넌트는 DomainsPage에서 항상 마운트되어 useState가 보존되므로,
   * 닫힘 직전에 입력값/에러 메시지를 직접 리셋해 재오픈 시 잔존을 방지한다 (#170, #161 패턴).
   */
  const handleClose = () => {
    if (bulkAdd.isPending) return;
    setText('');
    setParseError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onClose={handleClose}>
      {/* bulk-paste textarea의 가독 폭 확보 — host origin 쌍(60~70자)이 줄바꿈 없이 한 줄에 들어가도록 max-w-2xl(672px) 부여 (#274) */}
      <DialogContent data-testid="bulk-add-dialog" className="max-w-2xl" disableClose={bulkAdd.isPending}>
        <DialogTitle>도메인 일괄 추가</DialogTitle>
        <p className="text-xs text-muted-foreground mb-2">
          한 줄에 하나씩 <code className="text-xs bg-muted px-1 py-0.5 rounded">host origin</code> 형식으로 입력하세요.
        </p>
        {/* shadcn Textarea 컴포넌트 사용 — 포커스 링 두께/스타일을 Input과 통일 (#107) */}
        <Textarea
          value={text}
          // 입력 변경 시 이전 parseError 즉시 클리어 — 단건 폼(DomainsPage)과 동작 일치 (#380)
          // stale 에러가 유효한 입력 위에 잔존하면 사용자가 입력에 문제가 있다고 오인함
          onChange={(e) => { setText(e.target.value); setParseError(null); }}
          rows={8}
          className="font-mono resize-y"
          placeholder={"textbook.com https://textbook.com\ncdn.school.kr https://origin.school.kr"}
          data-testid="bulk-add-textarea"
          // 입력 단계 hard cap (#255) — 붙여넣기로 거대한 텍스트가 누적되는 것을 브라우저 차원에서 차단.
          // 줄 수 상한과 분리된 글자 수 가드(64KB)로, 한 줄짜리 초장문도 사전 거부된다.
          maxLength={BULK_ADD_MAX_INPUT_CHARS}
        />
        {/* 입력 미리보기 — 큰 입력(예: 1000줄) 붙여넣었을 때 의도치 않은 대량 등록 방지용 카운트 표시 (#219) */}
        <p
          className="text-xs text-muted-foreground mt-1"
          data-testid="bulk-add-preview"
          aria-live="polite"
        >
          {domainCount === 0
            ? '입력된 도메인이 없습니다.'
            : overLineLimit
              ? `${totalLines}줄 / 도메인 ${domainCount}개 — 최대 ${BULK_ADD_MAX_LINES}줄까지 등록할 수 있습니다.`
              : `${totalLines}줄 / 도메인 ${domainCount}개`}
        </p>
        {parseError && (
          <p className="text-xs text-destructive" data-testid="bulk-add-error">
            {parseError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={bulkAdd.isPending}>
            취소
          </Button>
          {/* 빈 입력 가드 — domainCount === 0 (입력 미리보기 "입력된 도메인이 없습니다." 상태)와
              버튼 disabled 신호를 동기화하여 toolbar 일괄 삭제와 일관성 확보 (#232) */}
          <Button
            onClick={handleSubmit}
            disabled={bulkAdd.isPending || domainCount === 0 || overLineLimit}
            data-testid="bulk-add-submit"
          >
            {bulkAdd.isPending
              ? '추가 중…'
              : domainCount > 0
                ? `일괄 추가 (${domainCount}건)`
                : '일괄 추가'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
