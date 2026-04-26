/** Table 컴포넌트 패밀리 — clean 스타일 (zebra 제거, hover 하이라이트만) */
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full text-sm', className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'border-b border-border bg-muted/60 text-xs text-muted-foreground uppercase tracking-wider',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50',
        className,
      )}
      {...props}
    />
  );
}

/** TableHead — th 요소에 scope="col" 기본값 설정 (스크린 리더가 열 헤더 인식) */
export function TableHead({ className, scope = 'col', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn('h-10 px-4 text-left font-semibold align-middle', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-4 py-2.5 align-middle tabular-nums', className)}
      {...props}
    />
  );
}
