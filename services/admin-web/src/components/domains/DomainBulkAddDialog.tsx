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

  /** 각 줄을 공백으로 split하여 { host, origin } 파싱 */
  function parseLines(): Array<{ host: string; origin: string }> | null {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const result: Array<{ host: string; origin: string }> = [];
    for (const line of lines) {
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
      result.push({ host: parts[0].toLowerCase(), origin });
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
      <DialogContent data-testid="bulk-add-dialog" disableClose={bulkAdd.isPending}>
        <DialogTitle>도메인 일괄 추가</DialogTitle>
        <p className="text-xs text-muted-foreground mb-2">
          한 줄에 하나씩 <code className="text-xs bg-muted px-1 py-0.5 rounded">host origin</code> 형식으로 입력하세요.
        </p>
        {/* shadcn Textarea 컴포넌트 사용 — 포커스 링 두께/스타일을 Input과 통일 (#107) */}
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="font-mono resize-y"
          placeholder={"textbook.com https://textbook.com\ncdn.school.kr https://origin.school.kr"}
          data-testid="bulk-add-textarea"
        />
        {/* 입력 미리보기 — 큰 입력(예: 1000줄) 붙여넣었을 때 의도치 않은 대량 등록 방지용 카운트 표시 (#219) */}
        <p
          className="text-xs text-muted-foreground mt-1"
          data-testid="bulk-add-preview"
          aria-live="polite"
        >
          {domainCount === 0
            ? '입력된 도메인이 없습니다.'
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
          <Button
            onClick={handleSubmit}
            disabled={bulkAdd.isPending}
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
