import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prenotazioni',
  description: 'Sistema di prenotazioni per attività su appuntamento',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
