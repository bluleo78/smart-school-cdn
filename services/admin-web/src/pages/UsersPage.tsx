/** 사용자 관리 페이지 — 목록/추가/비밀번호 재설정/비활성화/재활성화 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { listUsers, createUser, updatePassword, disableUser, enableUser, type UserItem } from '../api/users';
import { formatDate, formatDateTime } from '../lib/format';
// 충돌 정리(#190) loser 행의 `__dup_N__` sentinel 접두사를 표시 단계에서 제거 (#252)
import { formatUsername } from '../lib/users/format-username';
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
// confirmPassword: 신규 사용자 추가 시 재입력 — 단일 필드 + 토글 미사용 시 plaintext 미확인 오타 저장 방지 (#217, #211 패턴)
const createSchema = z.object({
  username: z.string()
    .min(1, '이메일을 입력해주세요.')
    .email('이메일 형식이 아닙니다.')
    // 서버 한도(254자)와 동기화 — 클라이언트에서 인라인 에러로 즉시 안내해 서버 400 왕복 방지 (#253).
    // 서버: services/admin-server/src/routes/users.ts `z.string().regex(EMAIL_LIKE_RE).max(254)`.
    .max(254, '이메일은 254자를 넘을 수 없습니다.'),
  password: z.string()
    .min(1, '비밀번호를 입력해주세요.')
    .min(8, '8자 이상 입력해주세요.'),
  confirmPassword: z.string().min(1, '비밀번호를 한 번 더 입력해주세요.'),
}).refine((d) => d.password === d.confirmPassword, {
  path: ['confirmPassword'],
  message: '비밀번호가 일치하지 않습니다.',
});
type CreateFormData = z.infer<typeof createSchema>;

// 비밀번호 재설정 폼: isSelf 여부에 따라 currentPassword 필드 조건부 필수 (이슈 #31)
// superRefine 대신 옵션 필드로 선언하고 핸들러에서 isSelf 체크
// confirmPassword: 새 비밀번호 재입력 — 단일 필드 + 토글 미사용 시 plaintext 미확인 오타 저장 방지 (#211)
const passwordSchema = z.object({
  currentPassword: z.string().optional(),
  password: z.string().min(1, '비밀번호를 입력해주세요.').min(8, '8자 이상 입력해주세요.'),
  confirmPassword: z.string().min(1, '비밀번호를 한 번 더 입력해주세요.'),
}).refine((d) => d.password === d.confirmPassword, {
  path: ['confirmPassword'],
  message: '비밀번호가 일치하지 않습니다.',
});
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
      toast.success('사용자가 추가되었습니다.');
      void qc.invalidateQueries({ queryKey: ['users'] });
      setCreateOpen(false);
      createForm.reset();
    },
    onError: (e) => {
      // 409 중복 / 400 invalid_input(형식·길이 위반) / 그 외 일반 실패로 분기.
      // 클라이언트 zod max(254)로 대부분 차단되지만, 멀티탭/IME paste 등 우회 시 서버 400을 사람이 읽을 수 있는
      // 토스트로 노출 (#253).
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      const status = err.response?.status;
      if (status === 409) {
        toast.error('이미 존재하는 이메일입니다.');
      } else if (status === 400 && err.response?.data?.error === 'invalid_input') {
        toast.error('이메일 형식이 올바르지 않거나 너무 깁니다 (최대 254자).');
      } else {
        toast.error('사용자 추가에 실패했습니다.');
      }
    },
  });

  const passwordMut = useMutation({
    mutationFn: ({ id, password, currentPassword }: { id: number; password: string; currentPassword?: string }) =>
      updatePassword(id, password, currentPassword),
    // 성공 시에만 다이얼로그 닫기 — 오류 시 입력값 보존을 위해 onSuccess로 이동
    // 성공 시 폼 초기화 — 다음 오픈 시 dirty state 잔존 방지 (#161)
    onSuccess: () => {
      toast.success('비밀번호가 재설정되었습니다.');
      setPasswordTarget(null);
      passwordForm.reset();
    },
    onError: (e) => {
      // 현재 비밀번호 오류와 일반 오류를 구분하여 안내 메시지 제공 (이슈 #31)
      const errCode = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      if (errCode === 'invalid_current_password') {
        toast.error('현재 비밀번호가 올바르지 않습니다.');
      } else if (errCode === 'current_password_required') {
        toast.error('현재 비밀번호를 입력해주세요.');
      } else {
        toast.error('비밀번호 재설정에 실패했습니다.');
      }
    },
  });

  const disableMut = useMutation({
    mutationFn: (id: number) => disableUser(id),
    // 성공 시 다이얼로그 닫기 — onClick에서 즉시 닫으면 isPending 렌더링 기회가 없으므로 onSuccess로 이동
    onSuccess: () => {
      toast.success('사용자가 비활성화되었습니다.');
      void qc.invalidateQueries({ queryKey: ['users'] });
      setDisableTarget(null);
    },
    onError: () => toast.error('사용자 비활성화에 실패했습니다.'),
  });

  // 비활성화된 사용자를 재활성화하는 뮤테이션 — enable API 호출 후 목록 갱신
  const enableMut = useMutation({
    mutationFn: (id: number) => enableUser(id),
    // 성공 시 다이얼로그 닫기 — onClick에서 즉시 닫으면 isPending 렌더링 기회가 없으므로 onSuccess로 이동
    onSuccess: () => {
      toast.success('사용자가 재활성화되었습니다.');
      void qc.invalidateQueries({ queryKey: ['users'] });
      setEnableTarget(null);
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

  // 빈 입력 가드 — 필수 필드가 비었으면 제출 버튼을 disabled 처리해 잘못된 affordance 차단 (#248, #232 패턴).
  // formState.isValid 대신 watch + trim 조합 — onChange 모드 미적용 폼에서도 실시간 반영되고
  // AddDomainDialog/DomainBulkAddDialog와 동일한 패턴으로 일관성 유지. zod refine은 의도적 입력 후 형식 검증용.
  const createUsername = createForm.watch('username') ?? '';
  const createPassword = createForm.watch('password') ?? '';
  const createConfirmPassword = createForm.watch('confirmPassword') ?? '';
  const createSubmitDisabled =
    createMut.isPending || !createUsername.trim() || !createPassword || !createConfirmPassword;

  // 비밀번호 재설정 폼 — 자기 자신 변경 시 currentPassword 도 빈 입력 가드에 포함 (#248).
  const isSelfPassword = passwordTarget?.id === myId;
  const resetCurrentPassword = passwordForm.watch('currentPassword') ?? '';
  const resetPassword = passwordForm.watch('password') ?? '';
  const resetConfirmPassword = passwordForm.watch('confirmPassword') ?? '';
  const passwordSubmitDisabled =
    passwordMut.isPending ||
    !resetPassword ||
    !resetConfirmPassword ||
    (isSelfPassword && !resetCurrentPassword);

  return (
    <div className="space-y-4">
      {/* 페이지 헤더 — h2로 통일 (다른 페이지와 일관성), 설명 텍스트 추가
       *  모바일(<md)에서 좁은 뷰포트(390px)면 라벨이 글자 단위로 줄바꿈되어
       *  flex-col로 stack 처리하고 데스크탑에서만 좌우 배치 (#177) */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">사용자 관리</h2>
          <p className="text-sm text-muted-foreground mt-1">관리자 계정을 추가하거나 비밀번호를 재설정합니다.</p>
        </div>
        {/* whitespace-nowrap — 좁은 뷰포트에서 "+ 사용자 추 / 가" 글자 단위 줄바꿈 방지 (#177) */}
        <Button className="whitespace-nowrap self-start md:self-auto" onClick={() => { createForm.reset(); setCreateOpen(true); }}>+ 사용자 추가</Button>
      </div>

      {/* 로딩 상태 — 스켈레톤으로 레이아웃 시프트 방지 */}
      {isLoading && <Skeleton className="h-40 w-full" />}

      {/* 에러 상태 — API 실패 시 빈 화면 대신 메시지 표시 */}
      {isError && (
        <p className="py-8 text-center text-sm text-muted-foreground">사용자 목록을 불러오지 못했습니다.</p>
      )}

      {/* 데이터 로드 완료 후 — shadcn Table 컴포넌트로 다른 페이지와 스타일 통일
       *  overflow-x-auto 래퍼 — 모바일(390px) 좁은 뷰포트에서 페이지 전체 가로 스크롤
       *  대신 테이블만 가로 스크롤되도록 격리 (#177) */}
      {!isLoading && !isError && (
        <div className="w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">이메일</TableHead>
              <TableHead className="whitespace-nowrap">생성일</TableHead>
              {/* 마지막 로그인 — iPad 세로(<lg, 1024px 미만) 에서는 숨겨 액션 컬럼 가시성 확보 (#279).
               *  정보 우선순위: 액션(파괴적 버튼) > 마지막 로그인. lg 이상에서만 노출. */}
              <TableHead className="whitespace-nowrap hidden lg:table-cell">마지막 로그인</TableHead>
              <TableHead className="whitespace-nowrap">상태</TableHead>
              <TableHead className="whitespace-nowrap">액션</TableHead>
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
            ) : users.map((u) => {
              // sentinel 접두사 가공 — `__dup_N__이메일` raw 노출 차단 (#252).
              // isArchivedDup이면 비밀번호 재설정/재활성화 액션을 잠가 잘못된 조작 방지.
              const { display: displayUsername, isArchivedDuplicate: isArchivedDup } = formatUsername(u.username);
              return (
              // hover:bg-muted/50 — 클릭 가능한 행임을 시각적으로 전달 (ByDomainTable 패턴과 일관성)
              // 비활성 사용자 행은 opacity-60 + bg-muted/30 + 이메일 text-muted-foreground 로 dimmed 처리.
              // 활성/비활성을 한눈에 식별 가능하도록 행 전체 시각 차이를 부여 (#218).
              <TableRow
                key={u.id}
                className={`hover:bg-muted/50 transition-colors ${u.disabled_at ? 'bg-muted/30 opacity-60' : ''}`}
                data-testid={`user-row-${u.id}`}
                data-disabled={u.disabled_at ? 'true' : 'false'}
                data-archived-duplicate={isArchivedDup ? 'true' : 'false'}
              >
                {/* 비활성 행은 이메일도 text-muted-foreground 로 톤다운 — Badge 외 텍스트 단서 추가 (#218).
                 *  보존된 충돌 항목(#252)은 sentinel 접두사 제거된 원본 이메일 + "보존된 충돌 항목" 라벨로 표시. */}
                <TableCell className={`whitespace-nowrap ${u.disabled_at ? 'text-muted-foreground' : ''}`}>
                  <span>{displayUsername}</span>
                  {isArchivedDup && (
                    <Badge variant="outline" className="ml-2 align-middle text-[10px]" data-testid="archived-duplicate-badge">
                      보존된 충돌 항목
                    </Badge>
                  )}
                </TableCell>
                {/* formatDate/formatDateTime — ko-KR 로케일 명시, 앱 전역 포맷 통일.
                 *  whitespace-nowrap — 좁은 뷰포트에서 timestamp가 글자 단위로 5줄 분할되는 현상 차단 (#177) */}
                <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(u.created_at)}</TableCell>
                {/* 마지막 로그인 — iPad 세로(<lg) 에서는 숨김 (#279). 헤더와 동일한 breakpoint */}
                <TableCell className="text-muted-foreground whitespace-nowrap hidden lg:table-cell">{u.last_login_at ? formatDateTime(u.last_login_at) : '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{u.disabled_at ? <Badge variant="outline">비활성</Badge> : <Badge variant="success">활성</Badge>}</TableCell>
                <TableCell className="space-x-2 whitespace-nowrap">
                  {/* 보존된 충돌 항목(#252)은 username이 sentinel로 변형되어 비밀번호 재설정/재활성화 의미가 없음 → disabled */}
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={isArchivedDup}
                    onClick={() => { passwordForm.reset(); setPasswordTarget(u); }}
                  >
                    비밀번호 재설정
                  </Button>
                  {/* 비활성 사용자에게는 재활성화 버튼 표시 — 활성 사용자에게는 비활성화 버튼 표시 */}
                  {u.disabled_at ? (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={isArchivedDup}
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
              );
            })}
          </TableBody>
        </Table>
        </div>
      )}

      {/* 사용자 추가 다이얼로그 */}
      {/* onClose — mutation 진행 중이면 ESC/백드롭 닫기 차단 (#188, #165 패턴) */}
      <Dialog open={createOpen} onClose={() => { if (!createMut.isPending) setCreateOpen(false); }}>
        {/* disableClose — mutation 진행 중 X 버튼 비활성화 (#188, #165 패턴) */}
        <DialogContent disableClose={createMut.isPending}>
          <DialogTitle>사용자 추가</DialogTitle>
          <form onSubmit={createForm.handleSubmit((d) => { createMut.mutate(d); })} className="space-y-3">
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79) */}
              <Label htmlFor="add-user-email">이메일</Label>
              {/* 이메일 입력 — autocomplete="username"으로 브라우저 자동완성·비밀번호 매니저 연동 지원.
               *  maxLength=254 — 서버 한도와 동기화한 입력 단계 가드. zod max(254)와 이중 방어 (#253).
               *  IME 환경에서도 키보드 입력 단계에서 길이 초과를 차단해 서버 왕복 비용 절감. */}
              <Input id="add-user-email" type="email" autoComplete="username" maxLength={254} {...createForm.register('username')} />
              {createForm.formState.errors.username && <p className="text-xs text-destructive">{createForm.formState.errors.username.message}</p>}
            </div>
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79) */}
              <Label htmlFor="add-user-password">비밀번호</Label>
              {/* PasswordInput — 표시/숨기기 토글 포함, autocomplete="new-password"로 자동완성 힌트 유지 (#76) */}
              <PasswordInput id="add-user-password" autoComplete="new-password" placeholder="8자 이상" {...createForm.register('password')} />
              {createForm.formState.errors.password && <p className="text-xs text-destructive">{createForm.formState.errors.password.message}</p>}
            </div>
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79)
               *  비밀번호 확인 — 단일 필드 + 토글 미사용 시 plaintext 미확인 오타 저장 방지 (#217, #211 패턴).
               *  zod refine 에서 password 와 일치 검증, 불일치 시 인라인 에러 표시 → mutation 차단 */}
              <Label htmlFor="add-user-password-confirm">비밀번호 확인</Label>
              {/* PasswordInput — 표시/숨기기 토글 포함, autocomplete="new-password" 동일 적용 */}
              <PasswordInput id="add-user-password-confirm" autoComplete="new-password" placeholder="비밀번호 재입력" {...createForm.register('confirmPassword')} />
              {createForm.formState.errors.confirmPassword && <p className="text-xs text-destructive">{createForm.formState.errors.confirmPassword.message}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {/* 취소 버튼 — mutation 진행 중 disabled (#188, #165 패턴) */}
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMut.isPending}>취소</Button>
              {/* isPending 중 disabled + 로딩 텍스트 — 중복 제출 방지.
               *  빈 입력 가드 — 필수 필드 미입력 시 disabled 로 잘못된 affordance 차단 (#248, #232 패턴) */}
              <Button type="submit" disabled={createSubmitDisabled}>{createMut.isPending ? '추가 중…' : '추가'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 비밀번호 재설정 다이얼로그 */}
      {/* onClose — Escape/backdrop 클릭 포함 모든 닫기 경로에서 폼 초기화 (#161),
       *           mutation 진행 중이면 닫기 차단 (#188, #165 패턴) */}
      <Dialog open={!!passwordTarget} onClose={() => { if (!passwordMut.isPending) { setPasswordTarget(null); passwordForm.reset(); } }}>
        {/* disableClose — mutation 진행 중 X 버튼 비활성화 (#188, #165 패턴) */}
        <DialogContent disableClose={passwordMut.isPending}>
          {/* sentinel 접두사 제거된 표시 이름 사용 (#252) */}
          <DialogTitle>{passwordTarget ? formatUsername(passwordTarget.username).display : ''} 비밀번호 재설정</DialogTitle>
          <form
            onSubmit={passwordForm.handleSubmit((d) => {
              if (!passwordTarget) return;
              // 자기 자신 변경 시 currentPassword 포함. 다른 사용자 변경 시 생략 (이슈 #31)
              const isSelf = passwordTarget.id === myId;
              // 자기 자신 변경 시 현재 비밀번호 빈값 클라이언트 검증 — 서버 왕복 없이 인라인 에러 표시 (#159)
              if (isSelf && !d.currentPassword) {
                passwordForm.setError('currentPassword', { message: '현재 비밀번호를 입력해주세요.' });
                return;
              }
              passwordMut.mutate({
                id: passwordTarget.id,
                password: d.password,
                ...(isSelf ? { currentPassword: d.currentPassword } : {}),
              });
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
            {/* 자기 자신 비밀번호 변경 시에만 현재 비밀번호 입력 필드 표시 (이슈 #31) */}
            {passwordTarget?.id === myId && (
              <div>
                {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 */}
                <Label htmlFor="current-password">현재 비밀번호</Label>
                {/* autocomplete="current-password" — 비밀번호 매니저 연동 (프로젝트 autocomplete 정책 준수)
                 *  placeholder — 빈 라벨로 컨텍스트 부족 문제 보완 (#193) */}
                <PasswordInput id="current-password" autoComplete="current-password" placeholder="현재 사용 중인 비밀번호" {...passwordForm.register('currentPassword')} />
                {passwordForm.formState.errors.currentPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.currentPassword.message}</p>
                )}
              </div>
            )}
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79) */}
              <Label htmlFor="reset-password">새 비밀번호</Label>
              {/* PasswordInput — 표시/숨기기 토글 포함, autocomplete="new-password"로 자동완성 힌트 유지 (#76)
               *  placeholder — 비밀번호 정책 힌트 노출, 빈 라벨 컨텍스트 보완 (#193) */}
              <PasswordInput id="reset-password" autoComplete="new-password" placeholder="8자 이상" {...passwordForm.register('password')} />
              {passwordForm.formState.errors.password && <p className="text-xs text-destructive">{passwordForm.formState.errors.password.message}</p>}
            </div>
            <div>
              {/* htmlFor/id 연결 — 레이블 클릭 시 입력 필드 포커스·스크린 리더 연동 (#79)
               *  새 비밀번호 확인 — 단일 필드 + 토글 미사용 시 plaintext 미확인 오타 저장 방지 (#211).
               *  zod refine 에서 password 와 일치 검증, 불일치 시 인라인 에러 표시 → mutation 차단 */}
              <Label htmlFor="reset-password-confirm">새 비밀번호 확인</Label>
              {/* PasswordInput — 표시/숨기기 토글 포함, autocomplete="new-password" 동일 적용 */}
              <PasswordInput id="reset-password-confirm" autoComplete="new-password" placeholder="새 비밀번호 재입력" {...passwordForm.register('confirmPassword')} />
              {passwordForm.formState.errors.confirmPassword && <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              {/* 취소 버튼 — 닫기 시 폼 초기화 (dirty state 잔존 방지 #161),
               *              mutation 진행 중 disabled (#188, #165 패턴) */}
              <Button type="button" variant="outline" onClick={() => { setPasswordTarget(null); passwordForm.reset(); }} disabled={passwordMut.isPending}>취소</Button>
              {/* isPending 중 disabled + 로딩 텍스트 — 중복 제출 방지.
               *  빈 입력 가드 — 필수 필드 미입력 시 disabled. 자기 자신 변경 시 currentPassword 도 포함 (#248, #232 패턴) */}
              <Button type="submit" disabled={passwordSubmitDisabled}>{passwordMut.isPending ? '재설정 중…' : '재설정'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* 재활성화 확인 다이얼로그 — 비활성 사용자를 다시 활성화하기 전 의도 확인. 진행 중 ESC/백드롭/X 닫기 차단 (#165) */}
      <AlertDialog open={!!enableTarget} onClose={() => { if (!enableMut.isPending) setEnableTarget(null); }}>
        <AlertDialogContent className="max-w-sm" data-testid="enable-user-dialog" disableClose={enableMut.isPending}>
          <AlertDialogTitle>사용자 재활성화</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{enableTarget ? formatUsername(enableTarget.username).display : ''}</span>을(를) 재활성화하시겠습니까?
            재활성화된 사용자는 다시 로그인할 수 있습니다.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEnableTarget(null)} disabled={enableMut.isPending}>
              취소
            </Button>
            <Button
              disabled={enableMut.isPending}
              data-testid="enable-user-confirm"
              onClick={() => {
                if (!enableTarget) return;
                // setEnableTarget(null) 제거 — onSuccess 콜백에서 닫아야 isPending 로딩 상태 렌더링됨
                enableMut.mutate(enableTarget.id);
              }}
            >
              {enableMut.isPending ? '처리 중…' : '재활성화'}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* 비활성화 확인 다이얼로그 — 네이티브 confirm() 대신 shadcn AlertDialog로 UX 일관성 확보. 진행 중 ESC/백드롭/X 닫기 차단 (#165) */}
      <AlertDialog open={!!disableTarget} onClose={() => { if (!disableMut.isPending) setDisableTarget(null); }}>
        <AlertDialogContent className="max-w-sm" data-testid="disable-user-dialog" disableClose={disableMut.isPending}>
          <AlertDialogTitle>사용자 비활성화</AlertDialogTitle>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{disableTarget ? formatUsername(disableTarget.username).display : ''}</span>을(를) 비활성화하시겠습니까?
            비활성화된 사용자는 로그인할 수 없습니다.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisableTarget(null)} disabled={disableMut.isPending}>
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={disableMut.isPending}
              data-testid="disable-user-confirm"
              onClick={() => {
                if (!disableTarget) return;
                // setDisableTarget(null) 제거 — onSuccess 콜백에서 닫아야 isPending 로딩 상태 렌더링됨
                disableMut.mutate(disableTarget.id);
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
