import { createFileRoute } from '@tanstack/react-router';
import { localePagePrefixed } from '@/i18n/localePage';
import WatchLibrary from '@/components/media/WatchLibrary';
export const Route = createFileRoute('/$locale/watch/library')(localePagePrefixed('watch/library', WatchLibrary));
