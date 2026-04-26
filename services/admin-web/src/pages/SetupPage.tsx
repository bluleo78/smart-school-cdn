import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
import { setup as apiSetup } from '../api/auth';
import { useAuth } from '../components/auth/use-auth';
import { usePageTitle } from '../hooks/usePageTitle';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { PasswordInput } from '../components/ui/password-input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';

const schema = z.object({
  username: z.string().email('이메일 형식이 아닙니다'),
  password: z.string().min(8, '8자 이상'),
  password_confirm: z.string(),
}).refine(d => d.password === d.password_confirm, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['password_confirm'],
});

type FormData = z.infer<typeof schema>;

export function SetupPage() {
  // AppLayout 바깥에서 렌더링되므로 usePageTitle 로 직접 탭 타이틀 설정 — WCAG 2.4.2
  usePageTitle('초기 설정');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      await apiSetup(data.username, data.password);
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        setServerError('이미 초기 설정이 완료되었습니다. 로그인 페이지로 이동합니다.');
        setTimeout(() => navigate('/login', { replace: true }), 1500);
      } else {
        setServerError('설정 중 오류가 발생했습니다');
      }
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader>
          <CardTitle className="text-center">Smart School CDN 초기 설정</CardTitle>
          <p className="text-sm text-muted-foreground text-center">첫 관리자 계정을 등록하세요</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="username">이메일</Label>
              <Input id="username" type="email" autoFocus {...register('username')} />
              {errors.username && <p className="text-xs text-destructive mt-1" role="alert">{errors.username.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">비밀번호</Label>
              {/* PasswordInput — 표시/숨기기 토글 버튼 포함 (#76) */}
              <PasswordInput id="password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive mt-1" role="alert">{errors.password.message}</p>}
            </div>
            <div>
              <Label htmlFor="password_confirm">비밀번호 확인</Label>
              {/* PasswordInput — 각 필드가 독립적인 표시/숨기기 상태를 가짐 (#76) */}
              <PasswordInput id="password_confirm" {...register('password_confirm')} />
              {errors.password_confirm && <p className="text-xs text-destructive mt-1" role="alert">{errors.password_confirm.message}</p>}
            </div>
            {serverError && <p className="text-sm text-destructive" role="alert" data-testid="server-error">{serverError}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? '등록 중...' : '등록하고 시작하기'}
            </Button>
            <p className="text-xs text-muted-foreground">이 페이지는 한 번만 접근 가능합니다.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
