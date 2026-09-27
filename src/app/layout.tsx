import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hack The Box Chennai — Event Ticket Generator',
  description:
    'Official event ticket generator and check-in system for Hack The Box Chennai',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0d0f0e',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-htb-bg text-htb-text font-sans antialiased overflow-x-hidden min-w-[320px]">
        {children}
      </body>
    </html>
  );
}
