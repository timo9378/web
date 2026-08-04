import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Activity from '@/components/media/Activity';

export const Route = createFileRoute('/$locale/activity')(localePagePrefixed('activity', Activity));
