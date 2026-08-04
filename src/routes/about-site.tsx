import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import AboutSite from '@/components/about/AboutSite';
export const Route = createFileRoute('/about-site')(localePage('about-site', AboutSite));
