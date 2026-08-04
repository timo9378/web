import { createFileRoute } from '@tanstack/react-router';
import { localePageClient } from '@/i18n/localePage';
export const Route = createFileRoute('/photos')(localePageClient('photos', () => import('@/components/gallery/PhotoGallery')));
