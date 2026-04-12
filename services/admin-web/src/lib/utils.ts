import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 클래스 문자열 조합 + Tailwind 충돌 클래스 병합 유틸리티 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
