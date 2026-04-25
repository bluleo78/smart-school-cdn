/** Card 컴포넌트 — 기본: 소프트 쉐도우, glass: 글래스모피즘, interactive: 호버 시 살짝 떠오르는 카드 */
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type CardVariant = 'default' | 'glass';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** true 면 hover 시 살짝 떠오르는 인터랙션 추가 (clickable 카드용) */
  interactive?: boolean;
}

const variantClass: Record<CardVariant, string> = {
  default: 'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
  glass: 'rounded-xl bg-white/55 backdrop-blur-xl border border-white/60 dark:bg-white/8 dark:border-white/10 text-card-foreground',
};

export function Card({ variant = 'default', interactive = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(variantClass[variant], interactive && 'card-hover cursor-pointer', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold text-foreground', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}
