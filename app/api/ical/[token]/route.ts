// =====================================================================
//  GET /api/ical/[token] — flusso iCal dell'operatore (sola lettura).
//  L'operatore si abbona dal proprio telefono: gli appuntamenti Appunto
//  compaiono nel suo calendario personale. Il gettone segreto è l'unica
//  chiave: la funzione get_ical_feed non espone nient'altro.
// =====================================================================

import { getSupabaseServerClient } from '@/lib/supabase/server';

interface RigaFeed {
  operator_name: string;
  booking_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  service_name: string | null;
  customer_name: string | null;
}

/** Testo sicuro per un campo iCalendar. */
function icsTesto(testo: string): string {
  return testo.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** Istante ISO -> formato iCalendar UTC (YYYYMMDDTHHMMSSZ). */
function icsIstante(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return new Response('Non trovato', { status: 404 });
  }

  const supabase = getSupabaseServerClient();
  const { data: righe, error } = await supabase.rpc('get_ical_feed', { p_token: token });
  if (error || !righe || righe.length === 0) {
    return new Response('Non trovato', { status: 404 });
  }

  const feed = righe as RigaFeed[];
  const adesso = icsIstante(new Date().toISOString());
  const eventi = feed
    .filter((r) => r.booking_id && r.starts_at && r.ends_at)
    .map((r) =>
      [
        'BEGIN:VEVENT',
        `UID:${r.booking_id}@appunto`,
        `DTSTAMP:${adesso}`,
        `DTSTART:${icsIstante(r.starts_at!)}`,
        `DTEND:${icsIstante(r.ends_at!)}`,
        `SUMMARY:${icsTesto(`${r.service_name ?? 'Appuntamento'} · ${r.customer_name ?? 'Cliente'}`)}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
      ].join('\r\n'),
    );

  const calendario = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appunto//Prenotazioni//IT',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsTesto(`Appunto — ${feed[0].operator_name}`)}`,
    ...eventi,
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  return new Response(calendario, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
