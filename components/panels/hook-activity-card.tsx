// components/panels/hook-activity-card.tsx (STUB — replaced in block B)
'use client';

interface Props { range: string }

export default function HookActivityCard({ range: _range }: Props) {
  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 h-full">
      <div className="h-4 w-32 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="space-y-3">
        <div className="h-10 bg-brand-navy/60 rounded animate-pulse" />
        <div className="h-10 bg-brand-navy/60 rounded animate-pulse" />
        <div className="h-10 bg-brand-navy/60 rounded animate-pulse" />
      </div>
    </div>
  );
}
