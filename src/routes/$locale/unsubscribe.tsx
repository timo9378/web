import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import Unsubscribe from '@/components/account/Unsubscribe';
export const Route = createFileRoute('/$locale/unsubscribe')(localePagePrefixed('unsubscribe', Unsubscribe));
