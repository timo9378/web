import { useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/auth';
import KoimLoader from './KoimLoader';

function OAuthCallback() {
  const { t } = useTranslation();
  const search = useRouterState({ select: (s) => s.location.search }) as { code?: string; state?: string };
  const { loginWithOAuth } = useAuth();
  // 「網址沒帶 code」是純粹從 props 看得出來的事實，不需要繞一趟 state：
  // 原本在 effect 裡 setError，等於先繪一次 loading 畫面、effect 再補繪成錯誤畫面。
  // asyncError 才是真狀態（登入請求失敗後才知道）。
  const [asyncError, setAsyncError] = useState('');
  const error = search.code ? asyncError : t('oauth.errorNoCode');

  useEffect(() => {
    const code = search.code;
    const state = search.state; // provider name
    const provider = state ?? 'google'; // fallback

    if (!code) return;

    const redirectUri = `${window.location.origin}/auth/callback`;

    void loginWithOAuth(provider, code, redirectUri)
      .then(() => {
        // 回到之前的頁面
        const returnTo = sessionStorage.getItem('oauth_return_to') ?? '/blog';
        sessionStorage.removeItem('oauth_return_to');
        window.location.replace(returnTo); // 登入後整頁導回（順便刷新 auth 狀態）
      })
      .catch((err: unknown) => {
        console.error('OAuth login error:', err);
        setAsyncError(t('oauth.errorGeneric'));
      });
  }, []);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>❌ {error}</p>
          <button onClick={() => { window.location.assign('/blog'); }} style={{ padding: '8px 20px', borderRadius: '8px', background: 'rgba(127,90,240,0.2)', border: '1px solid rgba(127,90,240,0.4)', color: '#c4b5fd', cursor: 'pointer' }}>
{t('nav.notes')}
          </button>
        </div>
      </div>
    );
  }

  // 統一用站內 KoimLoader（不再用獨立的 spinner）
  return <KoimLoader fullscreen size="lg" text={t('oauth.loggingIn')} />;
}

export default OAuthCallback;
