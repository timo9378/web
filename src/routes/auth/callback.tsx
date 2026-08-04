import { createFileRoute } from '@tanstack/react-router';
import { localeWrap } from '@/i18n/localePage';
import OAuthCallback from '@/components/account/OAuthCallback';

// OAuth 落地頁:純 runtime handler(讀 ?code、登入、整頁導回),不需 SEO/多語/prerender。
export const Route = createFileRoute('/auth/callback')({ component: localeWrap(OAuthCallback) });
