import type { Metadata } from 'next';
import { DemoConsole } from '../../components/demo-console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Try Dira — synthetic demo' };

export default function TryPage() {
  return <DemoConsole />;
}
