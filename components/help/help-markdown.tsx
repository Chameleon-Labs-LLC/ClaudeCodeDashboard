'use client';

import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { slugify } from '@/lib/slugify';

function headingText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(headingText).join('');
  if (isValidElement<{ children?: ReactNode }>(children)) return headingText(children.props.children);
  return '';
}

export default function HelpMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-invert max-w-none
      prose-headings:text-chameleon-amber prose-headings:font-heading prose-headings:scroll-mt-20
      prose-a:text-brand-cyan-light prose-a:no-underline hover:prose-a:underline
      prose-code:text-chameleon-amber prose-code:bg-brand-navy-dark prose-code:px-1 prose-code:rounded
      prose-pre:bg-brand-navy-dark prose-pre:border prose-pre:border-brand-navy-light/30
      prose-strong:text-white
      prose-th:text-gray-300 prose-td:text-gray-400
      prose-hr:border-brand-navy-light/30"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 id={slugify(headingText(children))}>{children}</h2>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
