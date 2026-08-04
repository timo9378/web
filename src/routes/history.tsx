import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import History from '@/components/about/History';
export const Route = createFileRoute('/history')(localePage('history', History));
