// POST /api/prenotazione/[token]/riprogramma — cambio orario dal link
// personale del cliente. Porta sottile verso reschedule_booking_by_token
// (SECURITY DEFINER): rifà le stesse verifiche di create_booking
// (disponibilità, chiusure) e si appoggia allo stesso vincolo di
// esclusione del database contro le sovrapposizioni.
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let body: { nuovoInizio?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 });
  }
  if (!body.nuovoInizio) {
    return NextResponse.json({ error: 'Orario mancante' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.rpc('reschedule_booking_by_token', {
    p_token: token,
    p_new_starts_at: body.nuovoInizio,
  });
  if (error) {
    const slotConteso = error.message.includes('appena stato prenotato');
    return NextResponse.json({ error: error.message }, { status: slotConteso ? 409 : 400 });
  }
  return NextResponse.json({ ok: true });
}
