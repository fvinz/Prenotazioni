'use client';

// Agenda del portale admin: le prenotazioni del giorno, per operatore.
// Tutte le letture/scritture passano dal client Supabase autenticato:
// è la Row-Level Security a garantire che si vedano solo i dati del
// proprio salone (tenant_members -> my_tenant_ids nelle policy).

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Intestazione, useSalone } from './comuni';
import { NuovaPrenotazione } from './nuova-prenotazione';
import { ProponiAlternative } from './proponi-alternative';

interface Operatore {
  id: string;
  name: string;
}

interface Prenotazione {
  id: string;
  operator_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  services: { name: string } | null;
  customers: {
    first_name: string;
    last_name: string | null;
    phone: string;
    email: string | null;
  } | null;
}

const STATO: Record<string, string> = {
  cancelled: 'annullata',
  completed: 'completata',
  no_show: 'no-show',
};

export default function AgendaAdmin() {
  const supabase = getSupabaseBrowserClient();
  const { salone, ruolo, errore: erroreAccesso } = useSalone();

  const [operatori, setOperatori] = useState<Operatore[]>([]);
  const [data, setData] = useState(() => DateTime.now().toISODate()!);
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [nuova, setNuova] = useState(false);
  const [proposta, setProposta] = useState<Prenotazione | null>(null);

  useEffect(() => {
    if (!salone) return;
    (async () => {
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name')
        .eq('tenant_id', salone.id)
        .order('name');
      setOperatori(ops ?? []);
    })();
  }, [supabase, salone]);

  // Prenotazioni del giorno selezionato (nel fuso del salone).
  const carica = useCallback(async () => {
    if (!salone) return;
    setPrenotazioni(null);
    const inizio = DateTime.fromISO(data, { zone: salone.timezone }).startOf('day');
    const { data: rows, error } = await supabase
      .from('bookings')
      .select(
        'id, operator_id, service_id, starts_at, ends_at, status, services(name), customers(first_name, last_name, phone, email)',
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

  async function cambiaStato(p: Prenotazione, stato: 'completed' | 'no_show' | 'cancelled') {
    if (stato !== 'completed') {
      const domanda =
        stato === 'cancelled'
          ? 'Annullare questa prenotazione?'
          : 'Segnare il cliente come no-show?';
      if (!window.confirm(domanda)) return;
    }
    const { error } = await supabase.from('bookings').update({ status: stato }).eq('id', p.id);
    if (error) {
      setErrore('Non sono riuscito ad aggiornare la prenotazione. Riprova.');
      return;
    }
    // Dopo un annullamento: proponi al cliente gli orari alternativi.
    if (stato === 'cancelled' && p.customers) setProposta(p);
    carica();
  }

  if (erroreAccesso || errore) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <p className="rounded-xl bg-sabbia p-4">{erroreAccesso ?? errore}</p>
      </main>
    );
  }
  if (!salone) {
    return <main className="p-8 text-center text-inchiostro/60">Un attimo…</main>;
  }

  const giorno = DateTime.fromISO(data, { zone: salone.timezone });
  const oggi = DateTime.now().setZone(salone.timezone).toISODate()!;
  const oraLocale = (iso: string) =>
    DateTime.fromISO(iso).setZone(salone.timezone).toFormat('HH:mm');

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <Intestazione salone={salone} ruolo={ruolo} />

      <div className="mb-4 flex items-center justify-between rounded-xl bg-sabbia px-4 py-2">
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
          {data !== oggi && (
            <button
              onClick={() => setData(oggi)}
              className="rounded-lg bg-terracotta px-2 py-1 text-xs font-semibold text-crema transition hover:opacity-90"
            >
              Oggi
            </button>
          )}
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

      <button
        onClick={() => setNuova(true)}
        className="mb-6 w-full rounded-xl bg-terracotta py-3 font-semibold text-crema transition hover:opacity-90"
      >
        + Nuova prenotazione
      </button>

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
                        className={`rounded-xl border border-sabbia bg-white/60 px-4 py-3 ${
                          p.status === 'cancelled' ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
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
                            <div className="flex shrink-0 flex-col items-end gap-1 text-sm">
                              <button
                                onClick={() => cambiaStato(p, 'completed')}
                                className="text-inchiostro/70 hover:text-inchiostro hover:underline"
                              >
                                ✓ Fatta
                              </button>
                              <button
                                onClick={() => cambiaStato(p, 'no_show')}
                                className="text-inchiostro/70 hover:text-inchiostro hover:underline"
                              >
                                No-show
                              </button>
                              <button
                                onClick={() => cambiaStato(p, 'cancelled')}
                                className="text-terracotta hover:underline"
                              >
                                Annulla
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {proposta && proposta.customers && (
        <ProponiAlternative
          salone={salone}
          servizioId={proposta.service_id}
          servizioNome={proposta.services?.name ?? 'Appuntamento'}
          operatoreId={proposta.operator_id}
          clienteNome={proposta.customers.first_name}
          clienteCognome={proposta.customers.last_name}
          clienteTelefono={proposta.customers.phone}
          clienteEmail={proposta.customers.email}
          vecchioInizio={proposta.starts_at}
          onChiudi={() => setProposta(null)}
        />
      )}

      {nuova && (
        <NuovaPrenotazione
          salone={salone}
          operatori={operatori}
          dataIniziale={data}
          onChiudi={() => setNuova(false)}
          onCreata={() => {
            setNuova(false);
            carica();
          }}
        />
      )}
    </main>
  );
}
