import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import WatchLibrary from '@/components/media/WatchLibrary';
export const Route = createFileRoute('/watch/library')(localePage('watch/library', WatchLibrary));
