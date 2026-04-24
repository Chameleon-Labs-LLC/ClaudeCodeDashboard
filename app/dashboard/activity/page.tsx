import { FirehoseFeed } from '@/components/panels/firehose-feed';

export const metadata = { title: 'Activity — ClaudeCodeDashboard' };

export default function ActivityPage() {
  return (
    <main className="space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold text-brand-cyan">Activity</h1>
        <p className="mt-1 text-xs text-zinc-400">
          Live telemetry firehose. Every OTEL event ingested into SQLite lands here within ~2s.
        </p>
      </header>
      <FirehoseFeed />
    </main>
  );
}
