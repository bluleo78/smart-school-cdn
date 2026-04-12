/** Button 컴포넌트 — 시맨틱 토큰 기반 */
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'default' | 'outline' | 'destructive' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClass: Record<ButtonVariant, string> = {
  default:
    'bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent',
  outline:
    'bg-card text-foreground border border-border hover:bg-accent hover:text-accent-foreground',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 border border-transparent',
  ghost:
    'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground border border-transparent',
};

export function Button({ variant = 'default', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium',
        'transition-colors disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        className,
      )}
    />
  );
}
