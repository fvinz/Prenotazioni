// Pagina pubblica di gestione della prenotazione: /prenotazione/{token}.
// Server component sottile: legge i dati dal gettone (get_booking_by_token,
// SECURITY DEFINER — nessun accesso diretto alla tabella bookings) e la
// disponibilità dell'operatore, poi li passa al componente client.
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { GestisciPrenotazione, type DatiPrenotazione } from './gestisci';

export const dynamic = 'force-dynamic';

interface RigaPrenotazione {
  booking_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_timezone: string;
  booking_horizon_days: number;
  service_id: string;
  service_name: string;
  service_price_cents: number;
  operator_id: string;
  operator_name: string;
  modifica_entro: string | null;
}

export default async function PaginaGestionePrenotazione({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc('get_booking_by_token', { p_token: token });
  const riga = (data as unknown as RigaPrenotazione[] | null)?.[0];
  if (error || !riga) notFound();

  const { data: avRes } = await supabase
    .from('availability')
    .select('weekday')
    .eq('operator_id', riga.operator_id);

  const dati: DatiPrenotazione = {
    token,
    status: riga.status,
    startsAt: riga.starts_at,
    tenant: {
      name: riga.tenant_name,
      slug: riga.tenant_slug,
      timezone: riga.tenant_timezone,
      horizonDays: riga.booking_horizon_days,
    },
    servizio: { id: riga.service_id, name: riga.service_name, priceCents: riga.service_price_cents },
    operatore: { id: riga.operator_id, name: riga.operator_name },
    weekdayDisponibili: (avRes ?? []).map((a) => a.weekday),
    modificaEntro: riga.modifica_entro,
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-8">
      <header className="mb-8 text-center">
        <p className="font-display text-2xl">
          puntuale<span className="text-terracotta">.</span>
        </p>
        <h1 className="mt-4 font-display text-3xl tracking-tight">{dati.tenant.name}</h1>
      </header>
      <GestisciPrenotazione dati={dati} />
    </main>
  );
}
