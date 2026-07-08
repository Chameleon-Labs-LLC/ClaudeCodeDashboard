import HelpSidebar from '@/components/help/help-sidebar';
import HelpBanner from '@/components/help/help-banner';

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-brand-navy">
      <HelpSidebar />
      <main className="flex-1 flex flex-col overflow-auto">
        <HelpBanner />
        <div className="p-8 max-w-3xl w-full">{children}</div>
      </main>
    </div>
  );
}
