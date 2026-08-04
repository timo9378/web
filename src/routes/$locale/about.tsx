import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import AboutPage from '@/components/about/AboutPage';
export const Route = createFileRoute('/$locale/about')(localePagePrefixed('about', AboutPage));
