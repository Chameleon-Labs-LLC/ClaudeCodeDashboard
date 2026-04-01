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
  const badgeClass = typeBadgeColors[memory.type] || typeBadgeColors.reference;

  return (
    <div className="bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg p-4 hover:border-brand-cyan/20 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-white">{memory.name}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badgeClass}`}>
          {memory.type}
        </span>
      </div>
      {memory.description && (
        <p className="text-xs text-gray-400 mt-1">{memory.description}</p>
      )}
      <div className="mt-3 text-xs text-gray-500 bg-brand-navy-dark/50 rounded p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
        {memory.content}
      </div>
      <p className="text-xs text-gray-600 mt-2">{memory.fileName}</p>
    </div>
  );
}
