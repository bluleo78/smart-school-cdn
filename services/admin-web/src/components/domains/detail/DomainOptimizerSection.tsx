/// 도메인 설정 탭 — 최적화 프로파일 편집 섹션
import { useState } from 'react';
import { useOptimizerProfile } from '../../../hooks/useOptimizerProfile';
import { useUpdateOptimizerProfile } from '../../../hooks/useUpdateOptimizerProfile';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

interface Props {
  host: string;
}

export function DomainOptimizerSection({ host }: Props) {
  const { data: profile, isLoading } = useOptimizerProfile(host);
  const updateMutation = useUpdateOptimizerProfile();

  // 편집 중인 로컬 상태 — null이면 서버 값 사용 (파생 패턴)
  const [localQuality, setQuality] = useState<number | null>(null);
  const [localMaxWidth, setMaxWidth] = useState<number | null>(null);
  const [localEnabled, setEnabled] = useState<boolean | null>(null);

  const quality = localQuality ?? profile?.quality ?? 85;
  const maxWidth = localMaxWidth ?? profile?.max_width ?? 0;
  const enabled = localEnabled ?? profile?.enabled ?? true;

  /** 저장 */
  function handleSave() {
    updateMutation.mutate({ domain: host, quality, max_width: maxWidth, enabled });
  }

  /** 기본값으로 활성화 */
  function handleActivate() {
    updateMutation.mutate({ domain: host, quality: 85, max_width: 0, enabled: true });
  }

  return (
    <Card variant="glass" data-testid="domain-optimizer-section">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">최적화 프로파일</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">로드 중...</p>
        ) : profile ? (
          /* 프로파일 있으면 편집 폼 표시 */
          <div className="space-y-3">
            {/* quality */}
            <div className="space-y-1">
              <Label htmlFor="optimizer-quality" className="text-xs text-muted-foreground">
                품질 (1–100)
              </Label>
              <Input
                id="optimizer-quality"
                type="number"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="h-8 text-sm"
                data-testid="optimizer-quality-input"
              />
            </div>

            {/* max_width */}
            <div className="space-y-1">
              <Label htmlFor="optimizer-max-width" className="text-xs text-muted-foreground">
                최대 너비 px (0 = 무제한)
              </Label>
              <Input
                id="optimizer-max-width"
                type="number"
                min={0}
                value={maxWidth}
                onChange={(e) => setMaxWidth(Number(e.target.value))}
                className="h-8 text-sm"
                data-testid="optimizer-max-width-input"
              />
            </div>

            {/* enabled Switch */}
            <div className="flex items-center gap-2">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="optimizer-enabled-switch"
              />
              <Label className="text-sm">활성화</Label>
            </div>

            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              size="sm"
              data-testid="optimizer-save-btn"
            >
              {updateMutation.isPending ? '저장 중...' : '저장'}
            </Button>
          </div>
        ) : (
          /* 프로파일 없으면 안내 + 활성화 버튼 */
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">최적화 미설정</p>
            <p className="text-xs text-muted-foreground">
              이 도메인에 설정된 최적화 프로파일이 없습니다.
            </p>
            <Button
              onClick={handleActivate}
              disabled={updateMutation.isPending}
              size="sm"
              data-testid="optimizer-activate-btn"
            >
              {updateMutation.isPending ? '활성화 중...' : '기본값으로 활성화'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
