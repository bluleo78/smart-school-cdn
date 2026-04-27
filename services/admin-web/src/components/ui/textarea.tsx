/** Textarea — shadcn/ui 패턴. Input과 동일한 포커스 링/테두리 스타일 적용 */
import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm',
        'placeholder:text-muted-foreground',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-border/70',
        // Input과 동일한 focus-visible 패턴 — focus:ring-1 대신 focus-visible:ring-2 사용
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
