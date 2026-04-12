/** Badge 컴포넌트
 * shadcn/ui 스타일 호환 — variant: default | outline | destructive
 */
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'outline' | 'destructive';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-blue-100 text-blue-800',
  outline: 'border bg-transparent',
  destructive: 'bg-red-100 text-red-800',
};

export function Badge({ variant = 'default', className = '', ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantClass[variant]} ${className}`}
    />
  );
}
