import Link from 'next/link';
import { navItems } from '@/components/layout/nav-items';
import { getHelpTopic } from '@/lib/help-content';
import HelpMarkdown from '@/components/help/help-markdown';
import TopicPager from '@/components/help/topic-pager';

export const dynamic = 'force-dynamic';

export default async function HelpTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic: slug } = await params;
  const navItem = navItems.find((n) => n.helpSlug === slug);

  if (!navItem) {
    return (
      <div>
        <h1 className="font-heading text-2xl text-chameleon-amber mb-4">Topic not found</h1>
        <p className="text-gray-400 mb-6">
          No help topic named &ldquo;{slug}&rdquo;. Pick one below:
        </p>
        <ul className="space-y-1.5">
          {navItems.map((n) => (
            <li key={n.helpSlug}>
              <Link href={`/help/${n.helpSlug}`} className="text-chameleon-amber hover:underline">
                {n.icon} {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const topic = getHelpTopic(slug);
  if (!topic) {
    return (
      <div>
        <h1 className="font-heading text-3xl text-chameleon-amber mb-4">{navItem.label}</h1>
        <p className="text-gray-400">No help written for this page yet.</p>
        <TopicPager slug={slug} />
      </div>
    );
  }

  return (
    <article>
      <h1 className="font-heading text-3xl text-chameleon-amber mb-2">{topic.title}</h1>
      {topic.sections.length > 1 && (
        <nav className="mb-6 text-sm text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
          {topic.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="hover:text-chameleon-amber">
              {s.text}
            </a>
          ))}
        </nav>
      )}
      <HelpMarkdown content={topic.body} />
      <TopicPager slug={slug} />
    </article>
  );
}
