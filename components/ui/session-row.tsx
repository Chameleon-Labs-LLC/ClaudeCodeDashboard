import type { Session } from '@/types/claude';

interface SessionRowProps {
  session: Session;
  onClick?: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SessionRow({ session, onClick }: SessionRowProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-brand-navy-light/50 border border-brand-navy-light/30 rounded-lg hover:border-brand-cyan/20 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white truncate max-w-[60%]">
          {session.projectName}
        </span>
        <span className="text-xs text-gray-500">{timeAgo(session.lastActiveAt)}</span>
      </div>
      {session.summary && (
        <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">{session.summary}</p>
      )}
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
        <span>{session.messageCount} messages</span>
        <span>ID: {session.id.slice(0, 8)}</span>
      </div>
    </button>
  );
}
