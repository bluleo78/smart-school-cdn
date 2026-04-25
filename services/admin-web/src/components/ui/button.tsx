/** Button 컴포넌트 — 시맨틱 토큰 + variant/size 매트릭스 */
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant = 'default' | 'outline' | 'destructive' | 'ghost';
type ButtonSize = 'xs' | 'sm' | 'default' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  default:
    'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm hover:shadow-md border border-transparent',
  outline:
    'bg-card text-foreground border border-border hover:bg-accent hover:text-accent-foreground hover:border-border/70',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm hover:shadow-md border border-transparent',
  ghost:
    'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground border border-transparent',
};

const sizeClass: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-xs',
  sm: 'h-8 px-3 text-sm',
  default: 'h-9 px-4 text-sm',
  lg: 'h-10 px-6 text-sm',
  icon: 'size-9 p-0',
};

export function Button({
  variant = 'default',
  size = 'default',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-all duration-150 disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        sizeClass[size],
        variantClass[variant],
        className,
      )}
    />
  );
}
