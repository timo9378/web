import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import History from '@/components/about/History';
export const Route = createFileRoute('/$locale/history')(localePagePrefixed('history', History));
