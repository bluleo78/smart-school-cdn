/** Tabs 컴포넌트 — @radix-ui 없이 React 상태로 구현
 * shadcn/ui 인터페이스 호환: Tabs, TabsList, TabsTrigger, TabsContent
 */
import { createContext, useContext, useState, type HTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// ─── 컨텍스트 ────────────────────────────────────────────────────

interface TabsContextValue {
  value: string;
  onValueChange: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue>({ value: '', onValueChange: () => {} });

// ─── Tabs 루트 ───────────────────────────────────────────────────

interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
}

export function Tabs({ defaultValue = '', value, onValueChange, className, children, ...props }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value !== undefined ? value : internal;

  function handleChange(v: string) {
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
  }

  return (
    <TabsContext.Provider value={{ value: current, onValueChange: handleChange }}>
      <div className={cn('flex flex-col', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

// ─── TabsList ────────────────────────────────────────────────────

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center rounded-md bg-muted p-1 gap-0.5',
        className,
      )}
      {...props}
    />
  );
}

// ─── TabsTrigger ─────────────────────────────────────────────────

interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, children, ...props }: TabsTriggerProps) {
  const ctx = useContext(TabsContext);
  const isActive = ctx.value === value;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ─── TabsContent ─────────────────────────────────────────────────

interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const ctx = useContext(TabsContext);
  if (ctx.value !== value) return null;

  return (
    <div
      role="tabpanel"
      className={cn('mt-4 focus-visible:outline-none', className)}
      {...props}
    >
      {children}
    </div>
  );
}
