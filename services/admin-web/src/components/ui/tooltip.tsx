/** Tooltip — Radix Tooltip primitive 래퍼 (shadcn new-york 패턴)
 *  TooltipProvider는 AppLayout에서 전체를 감싸므로 개별 사용처에서는 불필요하다.
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

// Root/Provider/Trigger 은 함수형 래퍼로 export — react-refresh 규칙(only-export-components) 준수
export function TooltipProvider(
  props: ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>,
) {
  return <TooltipPrimitive.Provider delayDuration={300} {...props} />;
}

export function Tooltip(
  props: ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>,
) {
  return <TooltipPrimitive.Root {...props} />;
}

export function TooltipTrigger(
  props: ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>,
) {
  return <TooltipPrimitive.Trigger {...props} />;
}

/** TooltipContent — 포털로 렌더링되는 말풍선 본체.
 *  디자인 토큰(background/foreground)을 사용해 다크모드에서도 일관된 스타일을 유지한다.
 */
export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 overflow-hidden rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md',
          'animate-in fade-in-0 zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
