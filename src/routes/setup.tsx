import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Setup from '@/components/about/Setup';

// 原本手寫 head/component（早於 localePage 存在），做的事與 localePage 相同，
// 但也因此繞過集中式 SEO 表 → SSR 的 <title> 一直停在預設值。改用共用 wrapper。
export const Route = createFileRoute('/setup')(localePage('setup', Setup));
