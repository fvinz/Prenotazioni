// =====================================================================
//  POST /api/bookings — conferma di una prenotazione dal widget.
//
//  Porta sottile verso la RPC create_booking (SECURITY DEFINER, anon):
//  la validazione di dominio (servizio, operatore, disponibilità,
//  chiusure, doppio-booking) vive nel DATABASE. Qui si fa solo ciò che
//  il DB non può fare:
//   - normalizzazione del telefono in E.164 (critica per la dedup);
//   - honeypot anti-bot ("website": un umano non lo compila mai);
//   - mappatura degli errori in risposte HTTP con messaggi già in
//     italiano (sono quelli sollevati da create_booking).
//
//  Body JSON: { tenantSlug, operatorId, serviceId, startsAt (ISO),
//              nome, cognome, prefisso? (es. '+39'), telefono,
//              email?, website? }
// =====================================================================

import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { normalizzaTelefonoE164 } from '@/lib/phone';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 });
  }

  const { tenantSlug, operatorId, serviceId, startsAt, nome, cognome, prefisso, telefono, email, website } =
    body as { [k: string]: string | undefined };

  // Honeypot compilato: quasi certamente un bot. Fingiamo che sia andata
  // bene, senza toccare il database.
  if (website) {
    return NextResponse.json({ ok: true });
  }

  if (!tenantSlug || !operatorId || !serviceId || !startsAt || !nome?.trim() || !cognome?.trim() || !telefono?.trim()) {
    return NextResponse.json(
      { error: 'Compila tutti i campi obbligatori' },
      { status: 400 },
    );
  }

  // Il prefisso scelto nel widget (default +39) si applica solo se il
  // numero non è già in formato internazionale.
  const telefonoCompleto = telefono.trim().startsWith('+')
    ? telefono
    : `${prefisso ?? '+39'} ${telefono}`;
  const telefonoE164 = normalizzaTelefonoE164(telefonoCompleto);
  if (!telefonoE164) {
    return NextResponse.json(
      { error: 'Il numero di telefono non sembra valido' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { data: bookingId, error } = await supabase.rpc('create_booking', {
    p_tenant_slug: tenantSlug,
    p_operator_id: operatorId,
    p_service_id: serviceId,
    p_customer_first_name: nome.trim(),
    p_customer_last_name: cognome.trim(),
    p_customer_phone: telefonoE164,
    p_customer_email: email?.trim() || null,
    p_starts_at: startsAt,
  });

  if (error) {
    // I messaggi sollevati da create_booking sono già pensati per l'utente
    // finale (in italiano). Lo slot conteso è un conflitto: 409.
    const slotConteso = error.message.includes('appena stato prenotato');
    return NextResponse.json(
      { error: error.message },
      { status: slotConteso ? 409 : 400 },
    );
  }

  return NextResponse.json({ ok: true, bookingId });
}
