// =====================================================================
//  GET /api/slots — "porta" sottile verso la logica pura di lib/slots.ts.
//
//  Qui NON c'è logica di calcolo: si recuperano i dati (letture pubbliche
//  via RLS + RPC get_busy_intervals) e si delega tutto a generaSlotLiberi.
//
//  Query string:
//    tenantSlug  slug del salone (es. 'salone-mario')
//    operatorId  uuid dell'operatore (opzionale: assente = "chiunque sia
//                libero", aggrega gli slot di tutti gli operatori idonei)
//    serviceId   uuid del servizio
//    date        giorno locale del salone, 'YYYY-MM-DD'
//
//  Risposta: { "slots": [{ "start": ISO/UTC, "label": "HH:mm" }, ...] }
// =====================================================================

import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { generaSlotLiberi, type AvailabilityWindow, type BusyInterval } from '@/lib/slots';
import { unisciSlot } from '@/lib/widget-utils';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tenantSlug = params.get('tenantSlug');
  const operatorId = params.get('operatorId'); // assente = tutti gli operatori idonei
  const serviceId = params.get('serviceId');
  const date = params.get('date');

  if (!tenantSlug || !serviceId || !date) {
    return NextResponse.json(
      { error: 'Parametri richiesti: tenantSlug, serviceId, date' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // Salone: timezone per interpretare 'date' e config di prenotazione.
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, timezone, booking_horizon_days, min_lead_minutes')
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

  // Fuori dall'orizzonte di prenotazione del salone (o nel passato):
  // nessuno slot, senza nemmeno interrogare il DB.
  const oggi = DateTime.now().setZone(tenant.timezone).startOf('day');
  const scarto = dayStart.diff(oggi, 'days').days;
  if (scarto < 0 || scarto >= tenant.booking_horizon_days) {
    return NextResponse.json({ slots: [] });
  }

  const serviceRes = await supabase
    .from('services')
    .select('duration_minutes, buffer_minutes')
    .eq('id', serviceId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (serviceRes.error) {
    return NextResponse.json({ error: 'Errore nel recupero dei dati' }, { status: 500 });
  }
  if (!serviceRes.data) {
    return NextResponse.json({ error: 'Servizio non disponibile' }, { status: 404 });
  }
  const servizio = serviceRes.data;

  // Uno o più operatori: singolo se scelto dal cliente, altrimenti tutti
  // quelli attivi che erogano il servizio ("chiunque sia libero").
  let operatorIds: string[];
  if (operatorId) {
    const operatorRes = await supabase
      .from('operators')
      .select('id')
      .eq('id', operatorId)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (operatorRes.error) {
      return NextResponse.json({ error: 'Errore nel recupero dei dati' }, { status: 500 });
    }
    if (!operatorRes.data) {
      return NextResponse.json({ error: 'Operatore non trovato' }, { status: 404 });
    }
    operatorIds = [operatorId];
  } else {
    const opsvcRes = await supabase
      .from('operator_services')
      .select('operator_id, operators!inner(tenant_id)')
      .eq('service_id', serviceId)
      .eq('operators.tenant_id', tenant.id);
    if (opsvcRes.error) {
      return NextResponse.json({ error: 'Errore nel recupero dei dati' }, { status: 500 });
    }
    // RLS su operators limita già ai soli attivi (operators_public_read).
    operatorIds = [...new Set((opsvcRes.data ?? []).map((r) => r.operator_id))];
  }

  if (operatorIds.length === 0) {
    return NextResponse.json({ slots: [] });
  }

  // Per ciascun operatore: fasce + intervalli occupati (la RPC fonde già
  // prenotazioni e chiusure, non espone dati dei clienti), poi la stessa
  // funzione pura di sempre. In modalità "chiunque sia libero" gli slot
  // dei vari operatori vengono uniti — chi verrà assegnato si decide
  // dopo, in create_booking.
  const perOperatore = await Promise.all(
    operatorIds.map(async (opId) => {
      const [availabilityRes, busyRes] = await Promise.all([
        supabase.from('availability').select('weekday, start_time, end_time').eq('operator_id', opId),
        supabase.rpc('get_busy_intervals', {
          p_operator_id: opId,
          p_from: dayStart.toUTC().toISO(),
          p_to: dayEnd.toUTC().toISO(),
        }),
      ]);
      if (availabilityRes.error || busyRes.error) return null;

      const availability: AvailabilityWindow[] = (availabilityRes.data ?? []).map((a) => ({
        weekday: a.weekday,
        // Postgres 'time' arriva come 'HH:MM:SS': i primi 5 caratteri sono 'HH:mm'.
        startTime: String(a.start_time).slice(0, 5),
        endTime: String(a.end_time).slice(0, 5),
      }));
      const busy: BusyInterval[] = (busyRes.data ?? []).map(
        (b: { starts_at: string; ends_at: string }) => ({
          startsAt: b.starts_at,
          endsAt: b.ends_at,
        }),
      );

      return generaSlotLiberi({
        date,
        timezone: tenant.timezone,
        serviceDurationMinutes: servizio.duration_minutes,
        serviceBufferMinutes: servizio.buffer_minutes,
        availability,
        bookings: busy,
        timeOff: [],
        now: DateTime.utc().toISO(),
        minLeadMinutes: tenant.min_lead_minutes,
      });
    }),
  );

  if (perOperatore.some((s) => s === null)) {
    return NextResponse.json({ error: 'Errore nel recupero dei dati' }, { status: 500 });
  }

  const slots = unisciSlot(perOperatore as NonNullable<(typeof perOperatore)[number]>[]);

  return NextResponse.json({ slots });
}
