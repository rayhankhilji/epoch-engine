import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Epoch — a simulation engine for intelligence',
  description:
    'Hundreds of autonomous LLM agents living inside a persistent world grounded in real Earth. They think, act, trade, befriend, betray, build companies — and you watch it happen.',
};

export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
