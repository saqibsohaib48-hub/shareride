import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/app-context';
import { Header, BottomNav } from '@/components/shell';

export const metadata: Metadata = {
  title: 'Share Ride — Your Ride. Their Journey. Share the Way.',
  description: 'Share rides with people travelling your way. Fair distance-based prices, secure payments, verified members.',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0e7c66' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <AppProvider>
          <a href="#main" className="sr-only">Skip to content</a>
          <Header />
          <main id="main" className="container page">{children}</main>
          <BottomNav />
        </AppProvider>
      </body>
    </html>
  );
}
