/** Badge 컴포넌트
 * shadcn/ui 스타일 호환 — variant: default | outline | destructive | success | warning | info | pink
 */
import type { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'outline' | 'destructive' | 'success' | 'warning' | 'info' | 'pink';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary',
  outline: 'border bg-transparent',
  destructive: 'bg-destructive-subtle text-destructive',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  info: 'bg-info-subtle text-info',
  pink: 'bg-pink-subtle text-pink',
};

export function Badge({ variant = 'default', className = '', ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantClass[variant]} ${className}`}
    />
  );
}
