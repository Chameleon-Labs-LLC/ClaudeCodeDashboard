import type { Metadata } from 'next';
import { Roboto, Limelight } from 'next/font/google';
import './globals.css';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-roboto',
});

const limelight = Limelight({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-limelight',
});

export const metadata: Metadata = {
  title: 'Claude Code Dashboard',
  description: 'Local GUI dashboard for Claude Code — browse sessions, manage memory, search, and inspect usage',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${roboto.variable} ${limelight.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
