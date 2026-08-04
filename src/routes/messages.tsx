import { createFileRoute } from '@tanstack/react-router';
import { localePage } from '@/i18n/localePage';
import Messages from '@/components/about/Messages';

export const Route = createFileRoute('/messages')(localePage('messages', Messages));
