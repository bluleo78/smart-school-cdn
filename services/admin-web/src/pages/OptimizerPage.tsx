/// 최적화 설정 페이지 — 도메인별 프로파일 편집 + 절감 통계 카드
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogTitle,
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Slider } from '../components/ui/slider';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { useOptimizerProfiles, useUpdateOptimizerProfile } from '../hooks/useOptimizerProfiles';
import { useOptimizationStats } from '../hooks/useOptimizationStats';
import type { OptimizerProfile } from '../api/optimizer';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function OptimizerPage() {
  const { data: profilesData, isLoading } = useOptimizerProfiles();
  const { data: statsData } = useOptimizationStats();
  const updateProfile = useUpdateOptimizerProfile();
  const [editTarget, setEditTarget] = useState<OptimizerProfile | null>(null);

  const profiles = profilesData?.profiles ?? [];
  const stats = statsData?.stats ?? [];

  const totalOriginal  = stats.reduce((sum, s) => sum + s.original_bytes, 0);
  const totalOptimized = stats.reduce((sum, s) => sum + s.optimized_bytes, 0);
  const savingsPct = totalOriginal > 0
    ? ((1 - totalOptimized / totalOriginal) * 100).toFixed(1)
    : '0.0';

  async function handleSave() {
    if (!editTarget) return;
    try {
      await updateProfile.mutateAsync(editTarget);
      toast.success(`${editTarget.domain} 프로파일이 저장되었습니다.`);
      setEditTarget(null);
    } catch {
      toast.error('프로파일 저장에 실패했습니다.');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">최적화</h1>

      {/* 절감 통계 카드 */}
      <div className="grid grid-cols-3 gap-4" data-testid="optimization-stats-card">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">전체 절감률</p>
          <p className="text-2xl font-bold" data-testid="savings-pct">{savingsPct}%</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">원본 총 용량</p>
          <p className="text-2xl font-bold">{formatBytes(totalOriginal)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">최적화 후 용량</p>
          <p className="text-2xl font-bold">{formatBytes(totalOptimized)}</p>
        </div>
      </div>

      {/* 프로파일 테이블 */}
      <div className="rounded-lg border">
        <table className="w-full text-sm" data-testid="profiles-table">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left">도메인</th>
              <th className="px-4 py-3 text-left">품질</th>
              <th className="px-4 py-3 text-left">최대 폭</th>
              <th className="px-4 py-3 text-left">활성화</th>
              <th className="px-4 py-3 text-left">편집</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  로딩 중...
                </td>
              </tr>
            )}
            {!isLoading && profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground" data-testid="profiles-empty">
                  등록된 프로파일이 없습니다.
                </td>
              </tr>
            )}
            {profiles.map((p) => (
              <tr key={p.domain} className="border-b last:border-0" data-testid={`profile-row-${p.domain}`}>
                <td className="px-4 py-3 font-mono">{p.domain}</td>
                <td className="px-4 py-3">{p.quality}</td>
                <td className="px-4 py-3">{p.max_width === 0 ? '제한 없음' : `${p.max_width}px`}</td>
                <td className="px-4 py-3">
                  <Badge
                    variant={p.enabled ? 'default' : 'outline'}
                    data-testid="profile-enabled-badge"
                  >
                    {p.enabled ? '활성' : '비활성'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="outline"
                    data-testid="profile-edit-btn"
                    onClick={() => setEditTarget({ ...p })}
                  >
                    편집
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 편집 Dialog */}
      <Dialog open={!!editTarget} onClose={() => setEditTarget(null)}>
        <DialogContent data-testid="profile-edit-dialog">
          <DialogTitle>{editTarget?.domain} 프로파일 편집</DialogTitle>
          {editTarget && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>품질 ({editTarget.quality})</Label>
                <Slider
                  min={1} max={100} step={1}
                  value={[editTarget.quality]}
                  onValueChange={(vals: number[]) => setEditTarget({ ...editTarget, quality: vals[0] })}
                  data-testid="quality-slider"
                />
              </div>
              <div className="space-y-2">
                <Label>최대 폭 (px, 0=제한 없음)</Label>
                <Input
                  type="number" min={0}
                  value={editTarget.max_width}
                  onChange={(e) => setEditTarget({ ...editTarget, max_width: Number(e.target.value) })}
                  data-testid="max-width-input"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={editTarget.enabled}
                  onCheckedChange={(v) => setEditTarget({ ...editTarget, enabled: v })}
                  data-testid="enabled-switch"
                />
                <Label>활성화</Label>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditTarget(null)}>취소</Button>
            <Button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              data-testid="profile-save-btn"
            >
              저장
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
