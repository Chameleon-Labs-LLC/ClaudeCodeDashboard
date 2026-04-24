'use client';

import { useCallback, useState } from 'react';
import EmergencyStopBanner from '@/components/panels/emergency-stop-banner';
import TaskBoard from '@/components/panels/task-board';
import TaskComposer from '@/components/panels/task-composer';
import SchedulesCard from '@/components/panels/schedules-card';
import ScheduleComposer from '@/components/panels/schedule-composer';
import DecisionsCard from '@/components/panels/decisions-card';
import InboxCard from '@/components/panels/inbox-card';

export default function MissionControlPage() {
  const [composerOpen, setComposerOpen] = useState(false);
  const [schedComposerOpen, setSchedComposerOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-heading text-2xl text-brand-cyan">Mission Control</h2>
          <p className="text-xs text-gray-500 mt-1">Queue, dispatch, and reply to claude tasks.</p>
        </div>
        <div className="flex items-center gap-3">
          <EmergencyStopBanner onChange={bump} />
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md bg-brand-cyan text-brand-navy-dark font-medium"
          >+ New task</button>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DecisionsCard />
        <InboxCard />
      </section>

      <section>
        <TaskBoard onRefresh={bump} key={refreshKey} />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading text-lg text-brand-cyan">Schedules</h3>
          <button
            type="button"
            onClick={() => setSchedComposerOpen(true)}
            className="px-3 py-1.5 text-sm rounded-md border border-brand-cyan/50 text-brand-cyan hover:bg-brand-cyan/10"
          >+ New schedule</button>
        </div>
        <SchedulesCard onRefresh={bump} />
      </section>

      <TaskComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={bump}
      />
      <ScheduleComposer
        open={schedComposerOpen}
        onClose={() => setSchedComposerOpen(false)}
        onCreated={bump}
      />
    </div>
  );
}
