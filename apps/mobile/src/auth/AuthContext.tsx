import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../services/api/apiClient';
import { authService, type AuthService, type LoginInput, type RegisterInput } from '../services/api/authService';
import { secureStorage, type SecureTokenStorage } from '../services/storage/secureStorage';
import type { AuthUser } from '../types/auth';

export type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated' | 'error';

type AuthContextValue = {
  status: SessionStatus;
  user: AuthUser | null;
  error: string;
  notice: string;
  isSubmitting: boolean;
  restoreSession(): Promise<void>;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
  clearFeedback(): void;
};

export type AuthOperations = Pick<AuthService, 'setUnauthorizedHandler' | 'login' | 'register' | 'getCurrentUser'>;

const AuthContext = createContext<AuthContextValue | null>(null);

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

export function AuthProvider({
  children,
  service = authService,
  storage = secureStorage,
}: PropsWithChildren<{ service?: AuthOperations; storage?: SecureTokenStorage }>) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    service.setUnauthorizedHandler(() => {
      queryClient.clear();
      setUser(null);
      setError('Your session expired. Sign in again to continue.');
      setNotice('');
      setStatus('unauthenticated');
    });
    return () => service.setUnauthorizedHandler(undefined);
  }, [queryClient, service]);

  const restoreSession = useCallback(async () => {
    setStatus('restoring');
    setError('');
    try {
      const token = await storage.getToken();
      if (!token) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      const currentUser = await queryClient.fetchQuery({
        queryKey: ['auth', 'current-user'],
        queryFn: () => service.getCurrentUser(),
        staleTime: 0,
      });
      setUser(currentUser.user);
      setStatus('authenticated');
    } catch (restoreError) {
      if (restoreError instanceof ApiError && restoreError.status === 401) {
        await storage.deleteToken().catch(() => undefined);
        queryClient.clear();
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      setUser(null);
      setError(messageFor(restoreError));
      setStatus('error');
    }
  }, [queryClient, service, storage]);

  useEffect(() => { void restoreSession(); }, [restoreSession]);

  const authenticate = useCallback(async (action: () => Promise<{ user: AuthUser; token: string; message: string }>, successNotice = '') => {
    setIsSubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      await storage.setToken(result.token);
      queryClient.setQueryData(['auth', 'current-user'], { user: result.user });
      setUser(result.user);
      setNotice(successNotice || result.message);
      setStatus('authenticated');
    } catch (authError) {
      setError(messageFor(authError));
      throw authError;
    } finally {
      setIsSubmitting(false);
    }
  }, [queryClient, storage]);

  const login = useCallback((input: LoginInput) => authenticate(() => service.login(input)), [authenticate, service]);
  const register = useCallback((input: RegisterInput) => authenticate(() => service.register(input), 'Your Sutrula Payanam account is ready.'), [authenticate, service]);

  const logout = useCallback(async () => {
    setError('');
    setNotice('');
    try {
      await storage.deleteToken();
      queryClient.clear();
      setUser(null);
      setStatus('unauthenticated');
    } catch (logoutError) {
      setError(messageFor(logoutError));
      throw logoutError;
    }
  }, [queryClient, storage]);

  const clearFeedback = useCallback(() => { setError(''); setNotice(''); }, []);
  const value = useMemo(() => ({ status, user, error, notice, isSubmitting, restoreSession, login, register, logout, clearFeedback }), [status, user, error, notice, isSubmitting, restoreSession, login, register, logout, clearFeedback]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
