'use client';

import { useState } from 'react';
import Markdown from '@/components/ui/markdown';
import type { MemoryEntry } from '@/types/claude';

interface MemoryCardProps {
  memory: MemoryEntry;
}

const typeBadgeColors: Record<string, string> = {
  user: 'bg-chameleon-blue/20 text-chameleon-blue',
  feedback: 'bg-chameleon-amber/20 text-chameleon-amber',
  project: 'bg-chameleon-green/20 text-chameleon-green',
  reference: 'bg-chameleon-purple/20 text-chameleon-purple',
};

export default function MemoryCard({ memory }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const badgeClass = typeBadgeColors[memory.type] || typeBadgeColors.reference;
  const isLong = memory.content.length > 200;

  return (
    <div
      className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-white">{memory.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badgeClass}`}>
            {memory.type}
          </span>
        </div>
        {memory.description && (
          <p className="text-xs text-gray-400 mt-1">{memory.description}</p>
        )}
      </div>

      <div className={`px-4 pb-4 ${expanded ? '' : 'max-h-32 overflow-hidden relative'}`}>
        <div className="bg-brand-navy-dark/50 rounded-sm p-3">
          <Markdown content={expanded || !isLong ? memory.content : memory.content.slice(0, 200) + '...'} />
        </div>
        {!expanded && isLong && (
          <div className="absolute bottom-4 left-4 right-4 h-12 bg-linear-to-t from-brand-navy-light/50 to-transparent pointer-events-none rounded-b" />
        )}
      </div>

      <div className="flex items-center justify-between px-4 pb-3">
        <p className="text-xs text-gray-600">{memory.fileName}</p>
        {isLong && (
          <span className="text-xs text-brand-cyan">{expanded ? 'Collapse' : 'Expand'}</span>
        )}
      </div>
    </div>
  );
}
