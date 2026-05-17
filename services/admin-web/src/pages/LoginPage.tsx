import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../components/auth/use-auth';
import { usePageTitle } from '../hooks/usePageTitle';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { PasswordInput } from '../components/ui/password-input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';

// 빈 입력 우선 체크 → 포맷/길이 검증 순서로 단계적으로 에러 메시지 표시
const schema = z.object({
  username: z.string()
    .min(1, '이메일을 입력해주세요.')
    .email('이메일 형식이 아닙니다.'),
  password: z.string()
    .min(1, '비밀번호를 입력해주세요.')
    .min(8, '8자 이상 입력해주세요.'),
});

type FormData = z.infer<typeof schema>;

/**
 * 429 응답에서 재시도까지 남은 "분"을 추출 (#169).
 *
 * 우선순위:
 * 1) HTTP `retry-after` 헤더(초) — 60으로 나눠 올림 (최소 1분 보장)
 * 2) 응답 본문 message 에서 "<숫자> minutes" 또는 "<숫자>분" 패턴 추출
 *    (admin-server 메시지가 "요청이 너무 잦습니다. 15 minutes 후 ..." 같은 혼합 표기를 사용함)
 * 3) 모두 실패 시 null — 호출부가 "잠시 후" 같은 일반 카피로 폴백
 */
function extractRetryMinutes(retryAfter: string | undefined, message: string | undefined): number | null {
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec > 0) return Math.max(1, Math.ceil(sec / 60));
  }
  if (message) {
    const m = message.match(/(\d+)\s*(?:minutes?|분)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

export function LoginPage() {
  // AppLayout 바깥에서 렌더링되므로 usePageTitle 로 직접 탭 타이틀 설정 — WCAG 2.4.2
  usePageTitle('로그인');
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
      // 서버 에러 분기 — 401(자격증명 오류), 429(rate-limit) 별도 안내, 그 외 일반 오류 (#169)
      const err = e as { response?: { status?: number; headers?: Record<string, string>; data?: { message?: string } } };
      const status = err.response?.status;
      if (status === 401) {
        setServerError('아이디 또는 비밀번호가 올바르지 않습니다');
      } else if (status === 429) {
        // retry-after 헤더(초) 우선, 없으면 응답 본문 message 에서 분 단위 추출, 둘 다 없으면 "잠시 후"
        const minutes = extractRetryMinutes(err.response?.headers?.['retry-after'], err.response?.data?.message);
        const when = minutes != null ? `약 ${minutes}분 후` : '잠시 후';
        setServerError(`요청이 너무 잦습니다. ${when} 다시 시도해 주세요.`);
      } else {
        setServerError('로그인 중 오류가 발생했습니다');
      }
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
              {/* PasswordInput — 표시/숨기기 토글 버튼 포함 (#76) */}
              <PasswordInput id="password" autoComplete="current-password" {...register('password')} />
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
