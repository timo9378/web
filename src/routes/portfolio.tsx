import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Portfolio from '@/components/about/Portfolio';
export const Route = createFileRoute('/portfolio')(localePage('portfolio', Portfolio));
