/** 인증 컨텍스트 — Context 객체와 타입만 제공 (react-refresh 규칙 분리) */
import { createContext } from 'react';
import type { AuthUser } from '../../api/auth';

export type AuthStatus =
  | { status: 'loading' }
  | { status: 'needs_setup' }
  | { status: 'needs_login' }
  | { status: 'authenticated'; user: AuthUser };

export interface AuthContextValue {
  state: AuthStatus;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
