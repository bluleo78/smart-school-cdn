/** 사용자 관리 페이지 — 목록/추가/비밀번호 재설정/비활성화/재활성화 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { listUsers, createUser, updatePassword, disableUser, enableUser, type UserItem } from '../api/users';
import { formatDate, formatDateTime } from '../lib/format';
import { useAuth } from '../components/auth/use-auth';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog';
// 비활성화 확인 다이얼로그 — 네이티브 confirm() 대신 shadcn AlertDialog 사용 (디자인 시스템 일관성)
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Input } from '../components/ui/input';
import { PasswordInput } from '../components/ui/password-input';
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

// 빈 입력 우선 체크 → 포맷/길이 검증 순서로 단계적으로 에러 메시지 표시
const createSchema = z.object({
  username: z.string()
    .min(1, '이메일을 입력해주세요.')
    .email('이메일 형식이 아닙니다.'),
  password: z.string()
    .min(1, '비밀번호를 입력해주세요.')
    .min(8, '8자 이상 입력해주세요.'),
});
type CreateFormData = z.infer<typeof createSchema>;

// 비밀번호 재설정 폼: 빈 값 입력 시 명확한 안내 메시지 제공
const passwordSchema = z.object({ password: z.string().min(1, '비밀번호를 입력해주세요.').min(8, '8자 이상 입력해주세요.') });
type PasswordFormData = z.infer<typeof passwordSchema>;

export function UsersPage() {
  const qc = useQueryClient();
  const { state } = useAuth();
  const myId = state.status === 'authenticated' ? state.user.id : null;

  // isLoading: 데이터 로딩 중 스켈레톤 표시, isError: API 실패 시 에러 메시지 표시
  const { data: users, isLoading, isError } = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const createMut = useMutation({
    mutationFn: (d: CreateFormData) => createUser(d.username, d.password),
    // 성공 시에만 다이얼로그 닫기 + 폼 초기화 — 오류 시 입력값 보존을 위해 onSuccess로 이동
    onSuccess: () => {
      toast.success('사용자가 추가되었습니다');
      void qc.invalidateQueries({ queryKey: ['users'] });
      setCreateOpen(false);
      createForm.reset();
    },
    onError: (e) => {
      const status = (e as { response?: { status?: number } }).response?.status;
      toast.error(status === 409 ? '이미 존재하는 이메일입니다.' : '사용자 추가에 실패했습니다.');
    },
  });

  const passwordMut = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => updatePassword(id, password),
    // 성공 시에만 다이얼로그 닫기 — 오류 시 입력값 보존을 위해 onSuccess로 이동
    onSuccess: () => {
      toast.success('비밀번호가 재설정되었습니다');
      setPasswordTarget(null);
    },
    onError: () => toast.error('비밀번호 재설정에 실패했습니다.'),
  });

  const disableMut = useMutation({
    mutationFn: (id: number) => disableUser(id),
    onSuccess: () => {
      toast.success('사용자가 비활성화되었습니다');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('사용자 비활성화에 실패했습니다.'),
  });

  // 비활성화된 사용자를 재활성화하는 뮤테이션 — enable API 호출 후 목록 갱신
  const enableMut = useMutation({
    mutationFn: (id: number) => enableUser(id),
    onSuccess: () => {
      toast.success('사용자가 재활성화되었습니다');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('사용자 재활성화에 실패했습니다.'),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<UserItem | null>(null);
  // 비활성화 확인 다이얼로그 대상 — null이면 닫힘, UserItem이면 해당 사용자에 대한 확인창 표시
  const [disableTarget, setDisableTarget] = useState<UserItem | null>(null);
  // 재활성화 확인 다이얼로그 대상 — null이면 닫힘, UserItem이면 해당 사용자에 대한 확인창 표시
  const [enableTarget, setEnableTarget] = useState<UserItem | null>(null);
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
            {/* 빈 상태 처리 — users가 없거나 빈 배열일 때 안내 메시지 표시 (DomainsPage·DnsPage 패턴과 일관성) */}
            {!users || users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-sm text-muted-foreground">
                  등록된 사용자가 없습니다.
                </TableCell>
              </TableRow>
            ) : users.map((u) => (
              // hover:bg-muted/50 — 클릭 가능한 행임을 시각적으로 전달 (ByDomainTable 패턴과 일관성)
              <TableRow key={u.id} className="hover:bg-muted/50 transition-colors" data-testid={`user-row-${u.id}`}>
                <TableCell>{u.username}</TableCell>
                {/* formatDate/formatDateTime — ko-KR 로케일 명시, 앱 전역 포맷 통일 */}
                <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                <TableCell className="text-muted-foreground">{u.last_login_at ? formatDateTime(u.last_login_at) : '—'}</TableCell>
                <TableCell>{u.disabled_at ? <Badge variant="outline">비활성</Badge> : <Badge variant="success">활성</Badge>}</TableCell>
                <TableCell className="space-x-2">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => { passwordForm.reset(); setPasswordTarget(u); }}
                  >
                    비밀번호 재설정
                  </Button>
                  {/* 비활성 사용자에게는 재활성화 버튼 표시 — 활성 사용자에게는 비활성화 버튼 표시 */}
                  {u.disabled_at ? (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setEnableTarget(u)}
                    >
                      재활성화
                    </Button>
                  ) : (
                    /* 비활성화 버튼 — 클릭 시 shadcn AlertDialog로 확인 (네이티브 confirm() 제거) */
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={u.id === myId}
                      onClick={() => setDisableTarget(u)}
                    >
                      비활성화
                    </Button>
                  )}
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
          <form onSubmit={createForm.handleSubmit((d) => { createMut.mutate(d); })} className="space-y-3">
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79) */}
              <Label htmlFor="add-user-email">이메일</Label>
              {/* 이메일 입력 — autocomplete="username"으로 브라우저 자동완성·비밀번호 매니저 연동 지원 */}
              <Input id="add-user-email" type="email" autoComplete="username" {...createForm.register('username')} />
              {createForm.formState.errors.username && <p className="text-xs text-destructive">{createForm.formState.errors.username.message}</p>}
            </div>
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79) */}
              <Label htmlFor="add-user-password">비밀번호</Label>
              {/* PasswordInput — 표시/숨기기 토글 포함, autocomplete="new-password"로 자동완성 힌트 유지 (#76) */}
              <PasswordInput id="add-user-password" autoComplete="new-password" {...createForm.register('password')} />
              {createForm.formState.errors.password && <p className="text-xs text-destructive">{createForm.formState.errors.password.message}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>취소</Button>
              {/* isPending 중 disabled + 로딩 텍스트 — 중복 제출 방지 */}
              <Button type="submit" disabled={createMut.isPending}>{createMut.isPending ? '추가 중…' : '추가'}</Button>
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
              // 다이얼로그 닫기는 onSuccess에서 처리 — 오류 시 입력값 보존
              passwordMut.mutate({ id: passwordTarget.id, password: d.password });
            })}
            className="space-y-3"
          >
            {/* 비밀번호 매니저가 어떤 계정의 비밀번호인지 인식할 수 있도록 숨김 username 필드 제공 */}
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={passwordTarget?.username ?? ''}
            />
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79) */}
              <Label htmlFor="reset-password">새 비밀번호</Label>
              {/* PasswordInput — 표시/숨기기 토글 포함, autocomplete="new-password"로 자동완성 힌트 유지 (#76) */}
              <PasswordInput id="reset-password" autoComplete="new-password" {...passwordForm.register('password')} />
              {passwordForm.formState.errors.password && <p className="text-xs text-destructive">{passwordForm.formState.errors.password.message}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPasswordTarget(null)}>취소</Button>
              {/* isPending 중 disabled + 로딩 텍스트 — 중복 제출 방지 */}
              <Button type="submit" disabled={passwordMut.isPending}>{passwordMut.isPending ? '재설정 중…' : '재설정'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 재활성화 확인 다이얼로그 — 비활성 사용자를 다시 활성화하기 전 의도 확인 */}
      <AlertDialog open={!!enableTarget} onClose={() => setEnableTarget(null)}>
        <AlertDialogContent className="max-w-sm" data-testid="enable-user-dialog">
          <AlertDialogTitle>사용자 재활성화</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{enableTarget?.username}</span>을(를) 재활성화하시겠습니까?
            재활성화된 사용자는 다시 로그인할 수 있습니다.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEnableTarget(null)}>
              취소
            </Button>
            <Button
              disabled={enableMut.isPending}
              data-testid="enable-user-confirm"
              onClick={() => {
                if (!enableTarget) return;
                enableMut.mutate(enableTarget.id);
                setEnableTarget(null);
              }}
            >
              {enableMut.isPending ? '처리 중…' : '재활성화'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

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
