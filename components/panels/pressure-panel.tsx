// components/panels/pressure-panel.tsx (STUB — replaced in block B)
'use client';

interface Props { range: string }

export default function PressurePanel({ range: _range }: Props) {
  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5">
      <div className="h-4 w-36 bg-brand-navy/60 rounded animate-pulse mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="h-16 bg-brand-navy/60 rounded-lg animate-pulse" />
        <div className="h-16 bg-brand-navy/60 rounded-lg animate-pulse" />
        <div className="h-16 bg-brand-navy/60 rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
