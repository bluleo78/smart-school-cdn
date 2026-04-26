/** 사용자 관리 페이지 — 목록/추가/비밀번호 재설정/비활성화 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { listUsers, createUser, updatePassword, disableUser, type UserItem } from '../api/users';
import { useAuth } from '../components/auth/use-auth';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
// 비활성화 확인 다이얼로그 — 네이티브 confirm() 대신 shadcn AlertDialog 사용 (디자인 시스템 일관성)
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Skeleton } from '../components/ui/skeleton';

const createSchema = z.object({
  username: z.string().email('이메일 형식이 아닙니다'),
  password: z.string().min(8, '8자 이상'),
});
type CreateFormData = z.infer<typeof createSchema>;

const passwordSchema = z.object({ password: z.string().min(8, '8자 이상') });
type PasswordFormData = z.infer<typeof passwordSchema>;

export function UsersPage() {
  const qc = useQueryClient();
  const { state } = useAuth();
  const myId = state.status === 'authenticated' ? state.user.id : null;

  // isLoading: 데이터 로딩 중 스켈레톤 표시, isError: API 실패 시 에러 메시지 표시
  const { data: users, isLoading, isError } = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const createMut = useMutation({
    mutationFn: (d: CreateFormData) => createUser(d.username, d.password),
    onSuccess: () => {
      toast.success('사용자가 추가되었습니다');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => {
      const status = (e as { response?: { status?: number } }).response?.status;
      toast.error(status === 409 ? '이미 존재하는 이메일입니다' : '추가 실패');
    },
  });

  const passwordMut = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => updatePassword(id, password),
    onSuccess: () => toast.success('비밀번호가 재설정되었습니다'),
    onError: () => toast.error('비밀번호 재설정 실패'),
  });

  const disableMut = useMutation({
    mutationFn: (id: number) => disableUser(id),
    onSuccess: () => {
      toast.success('사용자가 비활성화되었습니다');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('비활성화 실패'),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<UserItem | null>(null);
  // 비활성화 확인 다이얼로그 대상 — null이면 닫힘, UserItem이면 해당 사용자에 대한 확인창 표시
  const [disableTarget, setDisableTarget] = useState<UserItem | null>(null);
  const createForm = useForm<CreateFormData>({ resolver: zodResolver(createSchema) });
  const passwordForm = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) });

  return (
    <div className="space-y-4">
      {/* 페이지 헤더 — h2로 통일 (다른 페이지와 일관성), 설명 텍스트 추가 */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">사용자 관리</h2>
          <p className="text-sm text-muted-foreground mt-1">관리자 계정을 추가하거나 비밀번호를 재설정합니다.</p>
        </div>
        <Button onClick={() => { createForm.reset(); setCreateOpen(true); }}>+ 사용자 추가</Button>
      </div>

      {/* 로딩 상태 — 스켈레톤으로 레이아웃 시프트 방지 */}
      {isLoading && <Skeleton className="h-40 w-full" />}

      {/* 에러 상태 — API 실패 시 빈 화면 대신 메시지 표시 */}
      {isError && (
        <p className="py-8 text-center text-sm text-muted-foreground">사용자 목록을 불러오지 못했습니다.</p>
      )}

      {/* 데이터 로드 완료 후 — shadcn Table 컴포넌트로 다른 페이지와 스타일 통일 */}
      {!isLoading && !isError && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              <TableHead>생성일</TableHead>
              <TableHead>마지막 로그인</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                <TableCell>{u.username}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                <TableCell className="text-muted-foreground">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</TableCell>
                <TableCell>{u.disabled_at ? <Badge variant="outline">비활성</Badge> : <Badge variant="success">활성</Badge>}</TableCell>
                <TableCell className="space-x-2">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => { passwordForm.reset(); setPasswordTarget(u); }}
                  >
                    비밀번호 재설정
                  </Button>
                  {/* 비활성화 버튼 — 클릭 시 shadcn AlertDialog로 확인 (네이티브 confirm() 제거) */}
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={u.id === myId || !!u.disabled_at}
                    onClick={() => setDisableTarget(u)}
                  >
                    비활성화
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* 사용자 추가 다이얼로그 */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogContent>
          <DialogTitle>사용자 추가</DialogTitle>
          <form onSubmit={createForm.handleSubmit((d) => { createMut.mutate(d); setCreateOpen(false); })} className="space-y-3">
            <div>
              <Label>이메일</Label>
              <Input type="email" {...createForm.register('username')} />
              {createForm.formState.errors.username && <p className="text-xs text-destructive">{createForm.formState.errors.username.message}</p>}
            </div>
            <div>
              <Label>비밀번호</Label>
              <Input type="password" {...createForm.register('password')} />
              {createForm.formState.errors.password && <p className="text-xs text-destructive">{createForm.formState.errors.password.message}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
              <Button type="submit">추가</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 비밀번호 재설정 다이얼로그 */}
      <Dialog open={!!passwordTarget} onClose={() => setPasswordTarget(null)}>
        <DialogContent>
          <DialogTitle>{passwordTarget?.username} 비밀번호 재설정</DialogTitle>
          <form
            onSubmit={passwordForm.handleSubmit((d) => {
              if (!passwordTarget) return;
              passwordMut.mutate({ id: passwordTarget.id, password: d.password });
              setPasswordTarget(null);
            })}
            className="space-y-3"
          >
            <div>
              <Label>새 비밀번호</Label>
              <Input type="password" {...passwordForm.register('password')} />
              {passwordForm.formState.errors.password && <p className="text-xs text-destructive">{passwordForm.formState.errors.password.message}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPasswordTarget(null)}>취소</Button>
              <Button type="submit">재설정</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 비활성화 확인 다이얼로그 — 네이티브 confirm() 대신 shadcn AlertDialog로 UX 일관성 확보 */}
      <AlertDialog open={!!disableTarget} onClose={() => setDisableTarget(null)}>
        <AlertDialogContent className="max-w-sm" data-testid="disable-user-dialog">
          <AlertDialogTitle>사용자 비활성화</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{disableTarget?.username}</span>을(를) 비활성화하시겠습니까?
            비활성화된 사용자는 로그인할 수 없습니다.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisableTarget(null)}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={disableMut.isPending}
              data-testid="disable-user-confirm"
              onClick={() => {
                if (!disableTarget) return;
                disableMut.mutate(disableTarget.id);
                setDisableTarget(null);
              }}
            >
              {disableMut.isPending ? '처리 중…' : '비활성화'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
