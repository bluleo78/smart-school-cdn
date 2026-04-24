/** useAuth — AuthProvider 내부에서만 사용 가능한 훅. react-refresh 규칙 상 별도 파일 분리. */
import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './auth-context';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
