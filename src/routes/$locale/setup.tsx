import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Setup from '@/components/about/Setup';

// 原本手寫 head/loader/component（早於 localePage 存在），做的事與 localePagePrefixed 相同
// （含 zh-TW/不合法前綴 → notFound 的守門），但也因此繞過集中式 SEO 表。改用共用 wrapper。
export const Route = createFileRoute('/$locale/setup')(localePagePrefixed('setup', Setup));
