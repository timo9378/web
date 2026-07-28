import { createContext, use, useState, useEffect, useCallback, type ReactNode } from 'react';

export type UserRole = 'OWNER' | 'ADMIN' | 'USER';

export interface User {
  id: string;
  role: UserRole;
  email?: string;
  name?: string;
  displayName?: string;
  display_name?: string;
  avatar?: string;
  avatar_url?: string;
  login?: string;
  html_url?: string;
  public_repos?: number;
  provider?: string;
}

interface OAuthProvider {
  enabled: boolean;
  clientId?: string;
}

interface AuthProviders {
  google: OAuthProvider;
  github: OAuthProvider;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  providers: AuthProviders;
  getToken: () => string | null;
  loginWithOAuth: (provider: string, code: string, redirectUri: string) => Promise<User>;
  logout: () => void;
  getGoogleAuthUrl: (redirectUri: string) => string;
  getGitHubAuthUrl: (redirectUri: string) => string;
  isLoggedIn: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'koimsurai_user_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProviders>({ google: { enabled: false }, github: { enabled: false } });

  // 載入 OAuth 提供者設定
  useEffect(() => {
    fetch('/api/auth/providers')
      .then((r) => r.json() as Promise<AuthProviders>)
      .then(setProviders)
      .catch(() => { /* 提供者設定載入失敗時靜默 */ });
  }, []);

  // 恢復 session
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLoading(false); return; }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<User>; })
      .then((u) => setUser(u))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), []);

  const loginWithOAuth = useCallback(async (provider: string, code: string, redirectUri: string) => {
    const res = await fetch(`/api/auth/${provider}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json() as { token: string; user: User };
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => { /* 登出 API 失敗無妨，本地已清 */ });
  }, []);

  // 產生 OAuth 授權 URL
  const getGoogleAuthUrl = useCallback((redirectUri: string) => {
    const params = new URLSearchParams({
      client_id: providers.google.clientId ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }, [providers]);

  const getGitHubAuthUrl = useCallback((redirectUri: string) => {
    const params = new URLSearchParams({
      client_id: providers.github.clientId ?? '',
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }, [providers]);

  return (
    <AuthContext value={{
      user, loading, providers,
      getToken, loginWithOAuth, logout,
      getGoogleAuthUrl, getGitHubAuthUrl,
      isLoggedIn: !!user,
      isAdmin: !!user && (user.role === 'ADMIN' || user.role === 'OWNER'),
      isOwner: !!user && user.role === 'OWNER',
    }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
