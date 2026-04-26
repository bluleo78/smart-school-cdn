import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../components/auth/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';

const schema = z.object({
  username: z.string().email('이메일 형식이 아닙니다'),
  password: z.string().min(8, '8자 이상'),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      await login(data.username, data.password);
      const rawFrom = searchParams.get('from') ?? '/';
      // Open Redirect 방지: 상대 경로만 허용.
      // http:// / https:// 또는 protocol-relative URL(//)로 시작하면 홈으로 fallback.
      const from = rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/';
      navigate(from, { replace: true });
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      setServerError(status === 401 ? '아이디 또는 비밀번호가 올바르지 않습니다' : '로그인 중 오류가 발생했습니다');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader>
          <CardTitle className="text-center">Smart School CDN</CardTitle>
          <p className="text-sm text-muted-foreground text-center">관리자 로그인</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="username">이메일</Label>
              <Input id="username" type="email" autoFocus autoComplete="username" {...register('username')} />
              {errors.username && <p className="text-xs text-destructive mt-1" role="alert">{errors.username.message}</p>}
            </div>
            <div>
              <Label htmlFor="password">비밀번호</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <p className="text-xs text-destructive mt-1" role="alert">{errors.password.message}</p>}
            </div>
            {serverError && <p className="text-sm text-destructive" role="alert" data-testid="server-error">{serverError}</p>}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
