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
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';

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

  const { data: users } = useQuery({ queryKey: ['users'], queryFn: listUsers });

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
  const createForm = useForm<CreateFormData>({ resolver: zodResolver(createSchema) });
  const passwordForm = useForm<PasswordFormData>({ resolver: zodResolver(passwordSchema) });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">사용자 관리</h1>
        <Button onClick={() => { createForm.reset(); setCreateOpen(true); }}>+ 사용자 추가</Button>
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b text-left text-sm text-muted-foreground">
            <th className="pb-2 font-medium">이메일</th>
            <th className="pb-2 font-medium">생성일</th>
            <th className="pb-2 font-medium">마지막 로그인</th>
            <th className="pb-2 font-medium">상태</th>
            <th className="pb-2 font-medium">액션</th>
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <tr key={u.id} className="border-b" data-testid={`user-row-${u.id}`}>
              <td className="py-2">{u.username}</td>
              <td className="py-2 text-sm text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
              <td className="py-2 text-sm text-muted-foreground">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
              <td className="py-2">{u.disabled_at ? <Badge variant="outline">비활성</Badge> : <Badge variant="success">활성</Badge>}</td>
              <td className="py-2 space-x-2">
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => { passwordForm.reset(); setPasswordTarget(u); }}
                >
                  비밀번호 재설정
                </Button>
                <Button
                  variant="destructive"
                  className="px-3 py-1 text-xs"
                  disabled={u.id === myId || !!u.disabled_at}
                  onClick={() => { if (confirm(`${u.username} 을 비활성화하시겠습니까?`)) disableMut.mutate(u.id); }}
                >
                  비활성화
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
    </div>
  );
}
