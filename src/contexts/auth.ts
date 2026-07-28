import { createContext, use } from 'react';
import type { AuthProvidersResponse } from '@koimsurai/api-types';

// 型別、context 物件、useAuth hook 放在純 .ts；AuthProvider 元件留在 AuthContext.tsx。
// 元件與非元件混在同一模組會讓 Vite Fast Refresh 對整支檔案退回整頁重載
// （react-refresh only-export-components）。

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

// OAuth provider 設定改吃後端 specta 生成的型別（backend handlers::auth::AuthProvidersResponse）。
// 原本手寫的那份把 clientId 標成可選、把 provider 標成可能缺席——都與後端實際行為不符：
// 後端一律回兩個 provider，clientId 沒設定時是空字串而不是缺欄位，enabled 才是判準。
// 那些「不符」正是 providers.github?.enabled 這類多餘防護的來源。
export type { AuthProvidersResponse } from '@koimsurai/api-types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  providers: AuthProvidersResponse;
  getToken: () => string | null;
  loginWithOAuth: (provider: string, code: string, redirectUri: string) => Promise<User>;
  logout: () => void;
  getGoogleAuthUrl: (redirectUri: string) => string;
  getGitHubAuthUrl: (redirectUri: string) => string;
  isLoggedIn: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const TOKEN_KEY = 'koimsurai_user_token';

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
