import Sidebar from '@/components/layout/sidebar';
import HelpButton from '@/components/help/help-button';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-brand-navy">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
      <HelpButton />
    </div>
  );
}
