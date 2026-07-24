// Pagina pubblica di prenotazione del salone: /{tenantSlug}.
// Server component sottile: carica i dati pubblici (RLS) e li passa al
// widget client. Tutta l'interazione vive in widget.tsx.
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { WidgetPrenotazione, type DatiSalone } from './widget';

export const dynamic = 'force-dynamic';

export default async function PaginaSalone({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = getSupabaseServerClient();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug, timezone, booking_horizon_days, min_lead_minutes')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (!tenant) notFound();

  const [servicesRes, operatorsRes, opsvcRes, availRes] = await Promise.all([
    supabase
      .from('services')
      .select('id, name, duration_minutes, price_cents')
      .eq('tenant_id', tenant.id)
      .order('name'),
    supabase
      .from('operators')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .order('name'),
    supabase.from('operator_services').select('operator_id, service_id'),
    supabase.from('availability').select('operator_id, weekday').eq('tenant_id', tenant.id),
  ]);

  const operatorIds = new Set((operatorsRes.data ?? []).map((o) => o.id));
  const dati: DatiSalone = {
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      horizonDays: tenant.booking_horizon_days,
    },
    servizi: servicesRes.data ?? [],
    operatori: operatorsRes.data ?? [],
    // operator_services è pubblica e globale: teniamo solo le coppie di
    // questo salone.
    operatoreServizi: (opsvcRes.data ?? []).filter((r) => operatorIds.has(r.operator_id)),
    // Weekday con almeno una fascia, per operatore (per il calendario).
    weekdayPerOperatore: (availRes.data ?? []).reduce<Record<string, number[]>>((acc, r) => {
      (acc[r.operator_id] ??= []).push(r.weekday);
      return acc;
    }, {}),
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-8">
      <header className="mb-8 text-center">
        <p className="font-display text-2xl">
          puntuale<span className="text-terracotta">.</span>
        </p>
        <h1 className="mt-4 font-display text-4xl tracking-tight">{tenant.name}</h1>
        <p className="mt-1 text-sm text-inchiostro/60">Prenota il tuo appuntamento.</p>
      </header>
      <Suspense fallback={<p className="text-center text-inchiostro/60">Un attimo…</p>}>
        <WidgetPrenotazione dati={dati} />
      </Suspense>
    </main>
  );
}
