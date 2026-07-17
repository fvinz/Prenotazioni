// Home minima del prodotto: il cuore è la pagina pubblica /[tenantSlug].
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-display text-6xl tracking-tight">
        appunto<span className="text-terracotta">.</span>
      </h1>
      <p className="text-lg">
        Le prenotazioni del tuo salone. <span className="font-semibold text-terracotta">Tue.</span>
      </p>
      <p className="max-w-sm text-sm text-inchiostro/60">
        Ogni salone ha la sua pagina di prenotazione. Chiedi il link al tuo
        salone di fiducia.
      </p>
    </main>
  );
}
