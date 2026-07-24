import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Puntuale — Le prenotazioni del tuo salone. Tue.',
  description:
    'Puntuale: il sistema di prenotazioni per saloni e attività su appuntamento.',
};

// I caratteri del brand arrivano da Google Fonts a runtime (link, non
// next/font): il build resta così indipendente dalla rete.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Gloock&family=IBM+Plex+Mono:wght@400;500&family=Work+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-crema font-sans text-inchiostro antialiased">
        {children}
      </body>
    </html>
  );
}
