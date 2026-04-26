/**
 * Dialog — Radix UI @radix-ui/react-dialog 기반 구현
 *
 * 왜 Radix UI로 교체하는가?
 * - 커스텀 구현은 ESC 닫기만 처리하고 포커스 복귀·포커스 트랩이 없었다 (이슈 #29).
 * - Radix Dialog는 WCAG 2.4.3 준수: 닫힘 후 트리거 버튼으로 포커스 복귀,
 *   열린 상태에서 Tab 포커스가 다이얼로그 안에만 갇히는 트랩 처리를 내장한다.
 *
 * 외부 API(onClose prop)는 그대로 유지하여 기존 호출 코드 변경 없음.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useRef, useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface DialogProps {
  open: boolean;
  /** 다이얼로그 닫기 요청 — ESC / 백드롭 클릭 시 호출 */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Dialog 루트 + 오버레이 래퍼.
 *
 * 포커스 복귀 전략:
 * Radix의 DialogContentModal.onCloseAutoFocus는 context.triggerRef.current?.focus()를
 * 호출하지만, 우리는 DialogPrimitive.Trigger 대신 일반 Button을 사용하므로
 * triggerRef가 null이 되어 포커스 복귀가 동작하지 않는다 (이슈 #29).
 *
 * 해결: open=true로 바뀔 때 document.activeElement를 openerRef에 저장하고,
 * onCloseAutoFocus 콜백에서 openerRef.current.focus()를 호출한다.
 * 이 패턴은 Radix 없이 커스텀 DialogContent를 쓸 때의 표준 접근법이다.
 */
export function Dialog({ open, onClose, children }: DialogProps) {
  // 다이얼로그를 연 요소(트리거 버튼)를 기억한다 — 닫힘 후 포커스 복귀에 사용
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      // 다이얼로그가 열릴 때 현재 포커스된 요소를 저장
      openerRef.current = document.activeElement;
    }
  }, [open]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(isOpen) => {
        // isOpen=false → 닫기 요청 (ESC, 백드롭 클릭 모두 포함)
        if (!isOpen) onClose();
      }}
    >
      {/* DialogContext에 openerRef를 주입하기 위해 children에 prop으로 내려줄 수 없으므로
          Context나 ref 공유가 필요하다. 대신 DialogContent에서 onCloseAutoFocus로 처리. */}
      <DialogPrimitive.Portal>
        {/* 반투명 백드롭 — 클릭 시 Radix가 onOpenChange(false) 호출 */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        {/* 다이얼로그 콘텐츠 컨테이너 — 중앙 정렬 */}
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {children}
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * DialogContent — Radix Content로 포커스 트랩 담당.
 *
 * onCloseAutoFocus 오버라이드 이유:
 * Radix DialogContentModal은 onCloseAutoFocus에서 event.preventDefault()를 호출한 뒤
 * context.triggerRef.current?.focus()를 시도한다. 그러나 우리 Dialog는
 * DialogPrimitive.Trigger 대신 일반 Button을 사용하므로 triggerRef가 null이다.
 * 결과적으로 포커스가 BODY로 이동한다.
 *
 * 해결: onCloseAutoFocus를 직접 제공하여 닫힐 때 document.activeElement가 아닌
 * 다이얼로그 바깥 마지막 포커스 요소(opener)를 복원하는 대신,
 * previouslyFocusedElement 캡처 방식을 사용한다.
 *
 * ⚠️ children에 native autoFocus 속성을 사용하지 말 것.
 * native autoFocus는 Radix FocusScope의 React useEffect보다 먼저 실행되어
 * BODY 복귀를 일으킨다. 대신 data-autofocus 또는 첫 번째 input을 수동 포커스할 것.
 */
export function DialogContent({ className, onCloseAutoFocus: externalOnCloseAutoFocus, ...props }: HTMLAttributes<HTMLDivElement> & {
  onCloseAutoFocus?: (e: Event) => void;
}) {
  // 다이얼로그 마운트 시 포커스 복귀 대상을 캡처한다
  const previousFocusRef = useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Content
      // aria-describedby={undefined}을 명시해 Radix의 "Missing Description" 경고를 억제한다.
      // 각 다이얼로그 본문이 직접 설명 텍스트를 포함하므로 별도 DialogDescription은 불필요하다.
      aria-describedby={undefined}
      className={cn('bg-card rounded-xl shadow-lg w-full max-w-md p-6 space-y-4', className)}
      onOpenAutoFocus={() => {
        // Radix FocusScope가 previouslyFocusedElement를 저장하기 전에 native autoFocus로
        // 포커스가 이동하는 것을 방지한다. 트리거 버튼을 포커스 복귀 대상으로 저장한다.
        previousFocusRef.current = document.activeElement as HTMLElement;
        // 기본 동작(첫 포커스 가능 요소 포커스)은 유지한다
      }}
      onCloseAutoFocus={(e) => {
        // Radix의 triggerRef 기반 복귀 대신 우리가 저장한 opener로 포커스를 복귀시킨다
        e.preventDefault();
        previousFocusRef.current?.focus();
        if (externalOnCloseAutoFocus) externalOnCloseAutoFocus(e);
      }}
      {...props}
    />
  );
}

/**
 * DialogTitle — 접근성을 위한 다이얼로그 제목.
 * Radix DialogTitle은 aria-labelledby를 자동 연결한다.
 */
export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold', className)}
      {...props}
    />
  );
}
