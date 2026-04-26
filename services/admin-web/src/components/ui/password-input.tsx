/** PasswordInput — 표시/숨기기 토글 버튼이 포함된 비밀번호 입력 컴포넌트
 *  기존 Input 스타일을 그대로 유지하고, 오른쪽에 Eye/EyeOff 아이콘 버튼을 추가한다.
 *  모든 비밀번호 입력 필드(LoginPage, SetupPage, UsersPage)에서 공통으로 사용한다.
 */
import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';

// Input과 동일한 props를 받되, type은 내부에서 관리하므로 제외
type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordInput({ className, ...props }: PasswordInputProps) {
  // 비밀번호 표시 여부 상태 — 기본값은 숨김(false)
  const [show, setShow] = useState(false);

  return (
    // 상대 위치 래퍼 — 아이콘 버튼을 절대 위치로 배치하기 위함
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 pr-9 text-sm',
          'placeholder:text-muted-foreground',
          'transition-[border-color,box-shadow] duration-150',
          'hover:border-border/70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {/* 표시/숨기기 토글 버튼 — type="button" 필수: form submit 방지 */}
      <button
        type="button"
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-center w-9',
          'text-muted-foreground hover:text-foreground',
          'transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-r-md',
        )}
        aria-label={show ? '비밀번호 숨기기' : '비밀번호 표시'}
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
