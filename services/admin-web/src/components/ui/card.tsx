/** Card 컴포넌트 — 기본: 소프트 쉐도우, glass: 글래스모피즘 */
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type CardVariant = 'default' | 'glass';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClass: Record<CardVariant, string> = {
  default: 'rounded-xl border border-border bg-card text-card-foreground shadow-sm shadow-primary/5 dark:shadow-none',
  glass: 'rounded-[14px] bg-white/55 backdrop-blur-xl border border-white/60 dark:bg-white/8 dark:border-white/10 text-card-foreground',
};

export function Card({ variant = 'default', className, ...props }: CardProps) {
  return <div className={cn(variantClass[variant], className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pb-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-medium text-muted-foreground', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}
