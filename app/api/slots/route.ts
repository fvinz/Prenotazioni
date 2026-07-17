// =====================================================================
//  GET /api/slots — "porta" sottile verso la logica pura di lib/slots.ts.
//
//  Qui NON c'è logica di calcolo: si recuperano i dati (letture pubbliche
//  via RLS + RPC get_busy_intervals) e si delega tutto a generaSlotLiberi.
//
//  Query string:
//    tenantSlug  slug del salone (es. 'salone-mario')
//    operatorId  uuid dell'operatore
//    serviceId   uuid del servizio
//    date        giorno locale del salone, 'YYYY-MM-DD'
//
//  Risposta: { "slots": [{ "start": ISO/UTC, "label": "HH:mm" }, ...] }
// =====================================================================

import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { generaSlotLiberi, type AvailabilityWindow, type BusyInterval } from '@/lib/slots';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tenantSlug = params.get('tenantSlug');
  const operatorId = params.get('operatorId');
  const serviceId = params.get('serviceId');
  const date = params.get('date');

  if (!tenantSlug || !operatorId || !serviceId || !date) {
    return NextResponse.json(
      { error: 'Parametri richiesti: tenantSlug, operatorId, serviceId, date' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // Salone: serve il timezone per interpretare 'date' come giorno locale.
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, timezone')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (tenantError) {
    return NextResponse.json({ error: 'Errore nel recupero del salone' }, { status: 500 });
  }
  if (!tenant) {
    return NextResponse.json({ error: 'Salone non trovato' }, { status: 404 });
  }

  const dayStart = DateTime.fromISO(date, { zone: tenant.timezone }).startOf('day');
  if (!dayStart.isValid) {
    return NextResponse.json({ error: 'Data non valida (attesa YYYY-MM-DD)' }, { status: 400 });
  }
  const dayEnd = dayStart.plus({ days: 1 });

  // Servizio (durata + buffer) e fasce dell'operatore: letture pubbliche
  // consentite dalle policy RLS. La RPC restituisce gli intervalli occupati
  // (prenotazioni attive + chiusure) senza esporre dati dei clienti.
  const [serviceRes, operatorRes, availabilityRes, busyRes] = await Promise.all([
    supabase
      .from('services')
      .select('duration_minutes, buffer_minutes')
      .eq('id', serviceId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    supabase
      .from('operators')
      .select('id')
      .eq('id', operatorId)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    supabase
      .from('availability')
      .select('weekday, start_time, end_time')
      .eq('operator_id', operatorId),
    supabase.rpc('get_busy_intervals', {
      p_operator_id: operatorId,
      p_from: dayStart.toUTC().toISO(),
      p_to: dayEnd.toUTC().toISO(),
    }),
  ]);

  if (serviceRes.error || operatorRes.error || availabilityRes.error || busyRes.error) {
    return NextResponse.json({ error: 'Errore nel recupero dei dati' }, { status: 500 });
  }
  if (!serviceRes.data) {
    return NextResponse.json({ error: 'Servizio non disponibile' }, { status: 404 });
  }
  if (!operatorRes.data) {
    return NextResponse.json({ error: 'Operatore non trovato' }, { status: 404 });
  }

  const availability: AvailabilityWindow[] = (availabilityRes.data ?? []).map((a) => ({
    weekday: a.weekday,
    // Postgres 'time' arriva come 'HH:MM:SS': i primi 5 caratteri sono 'HH:mm'.
    startTime: String(a.start_time).slice(0, 5),
    endTime: String(a.end_time).slice(0, 5),
  }));

  // La RPC fonde già prenotazioni e chiusure: per generaSlotLiberi la
  // distinzione è irrilevante (stessa regola di overlap).
  const busy: BusyInterval[] = (busyRes.data ?? []).map(
    (b: { starts_at: string; ends_at: string }) => ({
      startsAt: b.starts_at,
      endsAt: b.ends_at,
    }),
  );

  const slots = generaSlotLiberi({
    date,
    timezone: tenant.timezone,
    serviceDurationMinutes: serviceRes.data.duration_minutes,
    serviceBufferMinutes: serviceRes.data.buffer_minutes,
    availability,
    bookings: busy,
    timeOff: [],
    now: DateTime.utc().toISO(),
  });

  return NextResponse.json({ slots });
}
