import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Friends from '@/components/about/Friends';
export const Route = createFileRoute('/friends')(localePage('friends', Friends));
