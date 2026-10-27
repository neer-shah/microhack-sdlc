/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from 'react-query';
import { authChangedKey, guestCartId, guestCartKey, http, type AuthSession } from '../api/auth';
import { adoptGuestDraft, clearCheckoutDrafts } from '../api/checkoutRecovery';

interface AuthContextType {
  session: AuthSession | null | undefined;
  loading: boolean;
  error: unknown;
  isLoggedIn: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery<AuthSession | null>('auth-session', async () => {
    try {
      return (await http.get<AuthSession>('/api/auth/me')).data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {return null;}
      throw error;
    }
  }, { retry: 1, refetchOnWindowFocus: true, refetchInterval: 60000 });

  const removePrivateCache = async () => {
    await client.cancelQueries({ predicate: (query) => ['cart', 'checkout', 'recover-checkout', 'my-orders', 'my-order'].includes(String(query.queryKey[0])) });
    client.removeQueries({ predicate: (query) => ['cart', 'checkout', 'recover-checkout', 'my-orders', 'my-order'].includes(String(query.queryKey[0])) });
  };
  const authenticate = async (action: 'login' | 'register', email: string, password: string, name?: string) => {
    const { data } = await http.post<AuthSession>(`/api/auth/${action}`, {
      email, password, ...(name === undefined ? {} : { name }), guestCartId: guestCartId(),
    });
    adoptGuestDraft(data.user.userId);
    localStorage.setItem(guestCartKey, crypto.randomUUID());
    await client.cancelQueries('auth-session');
    await removePrivateCache();
    client.setQueryData('auth-session', data);
    localStorage.setItem(authChangedKey, crypto.randomUUID());
  };
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === authChangedKey || event.key === null) {
        clearCheckoutDrafts();
        client.removeQueries({ predicate: (query) => ['cart', 'checkout', 'recover-checkout', 'my-orders', 'my-order'].includes(String(query.queryKey[0])) });
        void client.invalidateQueries('auth-session');
      }
    };
    const interceptor = http.interceptors.response.use(undefined, (error: unknown) => {
      if (axios.isAxiosError(error) && error.response?.status === 401 && !error.config?.url?.startsWith('/api/auth/')) {
        void client.invalidateQueries('auth-session');
      }
      return Promise.reject(error);
    });
    window.addEventListener('storage', synchronize);
    return () => { window.removeEventListener('storage', synchronize); http.interceptors.response.eject(interceptor); };
  }, [client]);

  return <AuthContext.Provider value={{
    session: query.data, loading: query.isLoading, error: query.error,
    isLoggedIn: !!query.data, isAdmin: query.data?.user.role === 'admin',
    login: (email, password) => authenticate('login', email, password),
    register: (name, email, password) => authenticate('register', email, password, name),
    logout: async () => {
      await http.post('/api/auth/logout');
      await client.cancelQueries('auth-session');
      clearCheckoutDrafts();
      localStorage.setItem(guestCartKey, crypto.randomUUID());
      await removePrivateCache();
      client.setQueryData('auth-session', null);
      localStorage.setItem(authChangedKey, crypto.randomUUID());
    },
    refresh: async () => { await query.refetch(); },
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {throw new Error('useAuth must be used within an AuthProvider');}
  return context;
}
