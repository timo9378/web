import { createContext, use } from 'react';

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

export interface OAuthProvider {
  enabled: boolean;
  clientId?: string;
}

export interface AuthProviders {
  google: OAuthProvider;
  github: OAuthProvider;
}

export interface AuthContextValue {
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

export const AuthContext = createContext<AuthContextValue | null>(null);

export const TOKEN_KEY = 'koimsurai_user_token';

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
