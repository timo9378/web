import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Friends from '@/components/about/Friends';
export const Route = createFileRoute('/$locale/friends')(localePagePrefixed('friends', Friends));
