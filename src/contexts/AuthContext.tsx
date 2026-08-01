import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { AuthContext, TOKEN_KEY, shouldClearToken, type User, type AuthProvidersResponse } from './auth';

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
      .then(async (r) => {
        if (r.ok) return (await r.json()) as User;
        // 只有伺服器**明確說這個 token 不行**才清掉。原本是「非 2xx 一律清」，
        // 但 5xx、502、連線被斷都不是憑證問題——清掉的話一次後端重啟或網路抖動
        // 就把人登出，而且因為站上只有 OAuth 登入，要重跑一次授權才回得來。
        // （e2e 在高負載下就撞到過：/me 偶發失敗 → token 被刪 → 後台把人踢回首頁。）
        if (shouldClearToken(r.status)) localStorage.removeItem(TOKEN_KEY);
        return null;
      })
      .then((u) => { if (u) setUser(u); })
      // 中止與網路錯誤都走這裡，兩者都不該動 token：
      // 中止＝unmount，網路錯誤＝下次載入可能就好了。
      .catch(() => { /* 保留 token，這一次當作未登入 */ })
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
