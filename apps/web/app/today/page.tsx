import type { Metadata } from 'next';
import { TodayView } from '../../components/today-view';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Today — Dira' };

export default function TodayPage() {
  return <TodayView />;
}
