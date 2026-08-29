import { createFileRoute } from '@tanstack/react-router';
import { localePageClientPrefixed } from '@/i18n/localePage';
export const Route = createFileRoute('/$locale/photos')(
  localePageClientPrefixed('photos', () => import('@/components/gallery/PhotoGallery')),
);
