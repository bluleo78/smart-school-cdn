/// 도메인 일괄 추가 다이얼로그 — "host origin" 형식 텍스트 파싱
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { useBulkAddDomains } from '../../hooks/useBulkAddDomains';

interface DomainBulkAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DomainBulkAddDialog({ open, onOpenChange }: DomainBulkAddDialogProps) {
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const bulkAdd = useBulkAddDomains();

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
      result.push({ host: parts[0], origin: parts[1] });
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
      setText('');
      onOpenChange(false);
    } catch {
      // 오류 토스트는 훅에서 처리
    }
  }

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent data-testid="bulk-add-dialog">
        <DialogTitle>도메인 일괄 추가</DialogTitle>
        <p className="text-xs text-muted-foreground mb-2">
          한 줄에 하나씩 <code className="text-xs bg-muted px-1 py-0.5 rounded">host origin</code> 형식으로 입력하세요.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
          placeholder="textbook.com https://textbook.com&#10;cdn.school.kr https://origin.school.kr"
          data-testid="bulk-add-textarea"
        />
        {parseError && (
          <p className="text-xs text-destructive" data-testid="bulk-add-error">
            {parseError}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={bulkAdd.isPending}
            data-testid="bulk-add-submit"
          >
            {bulkAdd.isPending ? '추가 중…' : '일괄 추가'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
