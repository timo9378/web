import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import AboutPage from '@/components/about/AboutPage';
export const Route = createFileRoute('/about')(localePage('about', AboutPage));
