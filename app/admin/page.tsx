'use client';

// Agenda del portale admin: le prenotazioni del giorno, per operatore.
// Tutte le letture/scritture passano dal client Supabase autenticato:
// è la Row-Level Security a garantire che si vedano solo i dati del
// proprio salone (tenant_members -> my_tenant_ids nelle policy).

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';

interface Salone {
  id: string;
  name: string;
  timezone: string;
}

interface Operatore {
  id: string;
  name: string;
}

interface Prenotazione {
  id: string;
  operator_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  services: { name: string } | null;
  customers: { first_name: string; last_name: string | null; phone: string } | null;
}

const STATO: Record<string, string> = {
  confirmed: 'confermata',
  cancelled: 'annullata',
  completed: 'completata',
  no_show: 'no-show',
};

export default function AgendaAdmin() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [salone, setSalone] = useState<Salone | null>(null);
  const [operatori, setOperatori] = useState<Operatore[]>([]);
  const [data, setData] = useState(() => DateTime.now().toISODate()!);
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  // Guardia di accesso + caricamento del salone dell'utente.
  useEffect(() => {
    (async () => {
      const { data: sessione } = await supabase.auth.getSession();
      if (!sessione.session) {
        router.replace('/admin/login');
        return;
      }
      const { data: membership, error } = await supabase
        .from('tenant_members')
        .select('tenants(id, name, timezone)')
        .limit(1)
        .maybeSingle();
      const tenant = (membership?.tenants ?? null) as Salone | null;
      if (error || !tenant) {
        setErrore('Nessun salone associato a questo account.');
        return;
      }
      setSalone(tenant);
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name')
        .eq('tenant_id', tenant.id)
        .order('name');
      setOperatori(ops ?? []);
    })();
  }, [supabase, router]);

  // Prenotazioni del giorno selezionato (nel fuso del salone).
  const carica = useCallback(async () => {
    if (!salone) return;
    setPrenotazioni(null);
    const inizio = DateTime.fromISO(data, { zone: salone.timezone }).startOf('day');
    const { data: rows, error } = await supabase
      .from('bookings')
      .select(
        'id, operator_id, starts_at, ends_at, status, services(name), customers(first_name, last_name, phone)',
      )
      .eq('tenant_id', salone.id)
      .gte('starts_at', inizio.toUTC().toISO()!)
      .lt('starts_at', inizio.plus({ days: 1 }).toUTC().toISO()!)
      .order('starts_at');
    if (error) {
      setErrore('Non riesco a caricare le prenotazioni. Riprova.');
      return;
    }
    setPrenotazioni((rows ?? []) as unknown as Prenotazione[]);
  }, [supabase, salone, data]);

  useEffect(() => {
    carica();
  }, [carica]);

  async function annulla(id: string) {
    if (!window.confirm('Annullare questa prenotazione?')) return;
    const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
    if (error) {
      setErrore("Non sono riuscito ad annullare l'appuntamento. Riprova.");
      return;
    }
    carica();
  }

  async function esci() {
    await supabase.auth.signOut();
    router.replace('/admin/login');
  }

  if (errore) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <p className="rounded-xl bg-sabbia p-4">{errore}</p>
      </main>
    );
  }
  if (!salone) {
    return <main className="p-8 text-center text-inchiostro/60">Un attimo…</main>;
  }

  const giorno = DateTime.fromISO(data, { zone: salone.timezone });
  const oraLocale = (iso: string) =>
    DateTime.fromISO(iso).setZone(salone.timezone).toFormat('HH:mm');

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <p className="font-display text-2xl">
            appunto<span className="text-terracotta">.</span>
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">{salone.name}</h1>
        </div>
        <button onClick={esci} className="text-sm text-terracotta hover:underline">
          Esci
        </button>
      </header>

      <div className="mb-6 flex items-center justify-between rounded-xl bg-sabbia px-4 py-2">
        <button
          onClick={() => setData(giorno.minus({ days: 1 }).toISODate()!)}
          className="font-medium text-terracotta"
          aria-label="Giorno precedente"
        >
          ←
        </button>
        <div className="flex items-center gap-3">
          <span className="font-medium capitalize">
            {giorno.setLocale('it').toFormat('cccc d LLLL')}
          </span>
          <input
            type="date"
            value={data}
            onChange={(e) => e.target.value && setData(e.target.value)}
            className="rounded-lg border border-inchiostro/10 bg-white/60 px-2 py-1 text-sm"
            aria-label="Scegli una data"
          />
        </div>
        <button
          onClick={() => setData(giorno.plus({ days: 1 }).toISODate()!)}
          className="font-medium text-terracotta"
          aria-label="Giorno successivo"
        >
          →
        </button>
      </div>

      {prenotazioni === null ? (
        <p className="text-center text-inchiostro/60">Un attimo…</p>
      ) : prenotazioni.length === 0 ? (
        <p className="rounded-xl bg-white/60 p-6 text-center text-inchiostro/60">
          Nessuna prenotazione in questo giorno.
        </p>
      ) : (
        <div className="space-y-6">
          {operatori
            .filter((op) => prenotazioni.some((p) => p.operator_id === op.id))
            .map((op) => (
              <section key={op.id}>
                <h2 className="mb-2 font-display text-xl">{op.name}</h2>
                <ul className="space-y-2">
                  {prenotazioni
                    .filter((p) => p.operator_id === op.id)
                    .map((p) => (
                      <li
                        key={p.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border border-sabbia bg-white/60 px-4 py-3 ${
                          p.status === 'cancelled' ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-sm">
                            {oraLocale(p.starts_at)}–{oraLocale(p.ends_at)}
                          </p>
                          <p className="truncate font-medium">
                            {p.customers
                              ? `${p.customers.first_name} ${p.customers.last_name ?? ''}`.trim()
                              : 'Cliente'}
                            <span className="font-normal text-inchiostro/60">
                              {' '}
                              · {p.services?.name ?? 'Servizio'}
                            </span>
                          </p>
                          <p className="font-mono text-xs text-inchiostro/50">
                            {p.customers?.phone}
                            {p.status !== 'confirmed' && ` · ${STATO[p.status] ?? p.status}`}
                          </p>
                        </div>
                        {p.status === 'confirmed' && (
                          <button
                            onClick={() => annulla(p.id)}
                            className="shrink-0 text-sm text-terracotta hover:underline"
                          >
                            Annulla
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </main>
  );
}
