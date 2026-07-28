import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { AuthContext, TOKEN_KEY, type User, type AuthProvidersResponse } from './auth';

// 本檔只 export AuthProvider 元件；型別／context／useAuth 在 ./auth。

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProvidersResponse>({ google: { enabled: false, clientId: '' }, github: { enabled: false, clientId: '' } });

  // 載入 OAuth 提供者設定
  useEffect(() => {
    const ac = new AbortController();
    fetch('/api/auth/providers', { signal: ac.signal })
      .then((r) => r.json() as Promise<AuthProvidersResponse>)
      .then(setProviders)
      .catch(() => { /* 提供者設定載入失敗、或 unmount 中止 — 皆靜默 */ });
    return () => { ac.abort(); };
  }, []);

  // 恢復 session
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    // token 存在 localStorage，server 上讀不到 → 這個判斷只能在 effect 做（同 Comments）
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    if (!token) { setLoading(false); return; }
    const ac = new AbortController();
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<User>; })
      .then((u) => setUser(u))
      // 關鍵：中止不等於驗證失敗。少了這道守衛，unmount 會把使用者的 token 洗掉＝被登出。
      .catch(() => { if (!ac.signal.aborted) localStorage.removeItem(TOKEN_KEY); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => { ac.abort(); };
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
      client_id: providers.google.clientId,
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
      client_id: providers.github.clientId,
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
