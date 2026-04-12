/** Button 컴포넌트
 * shadcn/ui 스타일 호환 — variant: default | outline | destructive
 */
import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'default' | 'outline' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'bg-blue-600 text-white hover:bg-blue-700 border border-transparent',
  outline: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  destructive: 'bg-red-600 text-white hover:bg-red-700 border border-transparent',
};

export function Button({ variant = 'default', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variantClass[variant]} ${className}`}
    />
  );
}
