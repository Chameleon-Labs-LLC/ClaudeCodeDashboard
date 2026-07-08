import Link from 'next/link';
import { navItems } from '@/components/layout/nav-items';

export default function TopicPager({ slug }: { slug: string }) {
  const i = navItems.findIndex((n) => n.helpSlug === slug);
  if (i === -1) return null;
  const prev = i > 0 ? navItems[i - 1] : undefined;
  const next = i < navItems.length - 1 ? navItems[i + 1] : undefined;

  return (
    <nav aria-label="Help topics" className="mt-10 pt-4 border-t border-brand-navy-light/30 flex items-center justify-between text-sm">
      {prev ? (
        <Link href={`/help/${prev.helpSlug}`} className="text-chameleon-amber hover:underline">
          ◀ Prev: {prev.label}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`/help/${next.helpSlug}`} className="text-chameleon-amber hover:underline">
          Next: {next.label} ▶
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
