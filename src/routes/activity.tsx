import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Activity from '@/components/media/Activity';

export const Route = createFileRoute('/activity')(localePage('activity', Activity));
