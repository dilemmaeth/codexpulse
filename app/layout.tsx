import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodexPulse',
  description: 'Személyes Codex-használati és eredménykövető.',
  applicationName: 'CodexPulse',
  manifest: 'manifest.webmanifest',
  icons: {
    icon: [
      { url: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CodexPulse',
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#071018',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hu" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
