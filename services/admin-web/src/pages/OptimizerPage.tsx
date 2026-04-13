/// 최적화 설정 페이지 — 도메인별 프로파일 편집 + 절감 통계 카드
import { useState } from 'react';
import { Zap } from 'lucide-react';
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
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { formatBytes } from '../lib/format';
import { useOptimizerProfiles, useUpdateOptimizerProfile } from '../hooks/useOptimizerProfiles';
import { useOptimizationStats } from '../hooks/useOptimizationStats';
import type { OptimizerProfile } from '../api/optimizer';

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">최적화</h1>
        <p className="text-sm text-muted-foreground mt-1">도메인별 이미지 최적화 프로파일을 관리합니다.</p>
      </div>

      {/* 절감 통계 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="optimization-stats-card">
        <Card>
          <CardHeader><CardTitle>전체 절감률</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-primary" data-testid="savings-pct">{savingsPct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>원본 총 용량</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{formatBytes(totalOriginal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>압축 후 용량</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{formatBytes(totalOptimized)}</p>
          </CardContent>
        </Card>
      </div>

      {/* 프로파일 테이블 */}
      <Card>
        <CardHeader><CardTitle>프로파일 목록</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table data-testid="profiles-table">
            <TableHeader>
              <TableRow>
                <TableHead>도메인</TableHead>
                <TableHead>품질</TableHead>
                <TableHead>최대 폭</TableHead>
                <TableHead>활성화</TableHead>
                <TableHead>편집</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    로딩 중...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && profiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} data-testid="profiles-empty">
                    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                      <Zap size={32} className="opacity-30" />
                      <p className="text-sm">등록된 프로파일이 없습니다.</p>
                      <p className="text-xs">도메인을 추가하면 자동으로 프로파일이 생성됩니다.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {profiles.map((p) => (
                <TableRow key={p.domain} data-testid={`profile-row-${p.domain}`}>
                  <TableCell className="font-mono">{p.domain}</TableCell>
                  <TableCell>{p.quality}</TableCell>
                  <TableCell>{p.max_width === 0 ? '제한 없음' : `${p.max_width}px`}</TableCell>
                  <TableCell>
                    <Badge
                      variant={p.enabled ? 'default' : 'outline'}
                      data-testid="profile-enabled-badge"
                    >
                      {p.enabled ? '활성' : '비활성'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      data-testid="profile-edit-btn"
                      onClick={() => setEditTarget({ ...p })}
                    >
                      편집
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
            <Button variant="outline" data-testid="profile-cancel-btn" onClick={() => setEditTarget(null)}>취소</Button>
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
