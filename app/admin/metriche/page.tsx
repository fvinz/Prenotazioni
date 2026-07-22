'use client';

// Dashboard metriche (solo titolare): sintesi, riempimento, stagionalità,
// resa per servizio e per operatore, migliori clienti. Il calcolo è la
// funzione pura calcolaMetriche (lib/metriche.ts, testata); qui si
// recuperano i dati del periodo e si disegna. Tinta unica: terracotta.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { calcolaMetriche, type Metriche, type Prenotazione } from '@/lib/metriche';
import { Intestazione, useSalone } from '../comuni';

type Periodo = 'mese' | 'trimestre' | 'anno';
const GIORNI_PERIODO: Record<Periodo, number> = { mese: 30, trimestre: 90, anno: 365 };
const ETICHETTA: Record<Periodo, string> = {
  mese: 'Ultimo mese',
  trimestre: 'Ultimo trimestre',
  anno: 'Ultimo anno',
};

const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pct = (x: number) => `${Math.round(x * 100)}%`;

const minutiDaOra = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export default function MetricheAdmin() {
  const supabase = getSupabaseBrowserClient();
  const { salone, ruolo, errore } = useSalone();

  const [periodo, setPeriodo] = useState<Periodo>('anno');
  const [dati, setDati] = useState<Metriche | null>(null);
  const [erroreDati, setErroreDati] = useState<string | null>(null);

  const carica = useCallback(async () => {
    if (!salone || ruolo !== 'owner') return;
    setDati(null);
    setErroreDati(null);

    const oggi = DateTime.now().setZone(salone.timezone).startOf('day');
    const from = oggi.minus({ days: GIORNI_PERIODO[periodo] });
    const dallIso = from.toUTC().toISO()!;

    // Prenotazioni del periodo, a pagine (superano il limite di 1000 righe).
    const bookings: Prenotazione[] = [];
    const PAGINA = 1000;
    for (let inizio = 0; ; inizio += PAGINA) {
      const { data: rows, error } = await supabase
        .from('bookings')
        .select('operator_id, service_id, customer_id, starts_at, ends_at, status, price_cents, source')
        .eq('tenant_id', salone.id)
        .gte('starts_at', dallIso)
        .order('starts_at')
        .range(inizio, inizio + PAGINA - 1);
      if (error) {
        setErroreDati('Non riesco a caricare le metriche. Riprova.');
        return;
      }
      const blocco = (rows ?? []) as unknown as {
        operator_id: string;
        service_id: string;
        customer_id: string;
        starts_at: string;
        ends_at: string;
        status: Prenotazione['status'];
        price_cents: number;
        source: string;
      }[];
      bookings.push(
        ...blocco.map((b) => ({
          operatorId: b.operator_id,
          serviceId: b.service_id,
          customerId: b.customer_id,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
          status: b.status,
          priceCents: b.price_cents,
          source: b.source,
        })),
      );
      if (blocco.length < PAGINA) break;
    }

    const [opsRes, svcRes, avRes, custRes] = await Promise.all([
      supabase.from('operators').select('id, name').eq('tenant_id', salone.id).order('name'),
      supabase.from('services').select('id, name').eq('tenant_id', salone.id),
      supabase.from('availability').select('operator_id, weekday, start_time, end_time').eq('tenant_id', salone.id),
      supabase.from('customers').select('id, first_name, last_name, created_at').eq('tenant_id', salone.id),
    ]);

    const nomiClienti: Record<string, string> = {};
    const clientiCreatoIl: Record<string, string> = {};
    for (const c of custRes.data ?? []) {
      nomiClienti[c.id] = `${c.first_name} ${c.last_name ?? ''}`.trim();
      clientiCreatoIl[c.id] = c.created_at;
    }

    setDati(
      calcolaMetriche({
        from: from.toISODate()!,
        to: oggi.toISODate()!,
        timezone: salone.timezone,
        bookings,
        operatori: opsRes.data ?? [],
        servizi: svcRes.data ?? [],
        disponibilita: (avRes.data ?? []).map((a) => ({
          operatorId: a.operator_id,
          weekday: a.weekday,
          startMin: minutiDaOra(String(a.start_time)),
          endMin: minutiDaOra(String(a.end_time)),
        })),
        nomiClienti,
        clientiCreatoIl,
      }),
    );
  }, [supabase, salone, ruolo, periodo]);

  useEffect(() => {
    carica();
  }, [carica]);

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
  if (ruolo !== 'owner') {
    return (
      <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
        <Intestazione salone={salone} ruolo={ruolo} />
        <p className="rounded-xl bg-sabbia p-4 text-center">
          Le metriche sono riservate al titolare del salone.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-8">
      <Intestazione salone={salone} ruolo={ruolo} />

      <div className="mb-6 flex gap-2">
        {(Object.keys(GIORNI_PERIODO) as Periodo[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriodo(p)}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${
              periodo === p ? 'bg-inchiostro text-crema' : 'bg-white/60 hover:bg-sabbia'
            }`}
          >
            {ETICHETTA[p]}
          </button>
        ))}
      </div>

      {erroreDati ? (
        <p className="rounded-xl bg-sabbia p-4 text-center">{erroreDati}</p>
      ) : !dati ? (
        <p className="text-center text-inchiostro/60">Calcolo in corso…</p>
      ) : dati.nAppuntamenti === 0 ? (
        <p className="rounded-xl bg-white/60 p-6 text-center text-inchiostro/60">
          Ancora nessun dato per questo periodo.
        </p>
      ) : (
        <div className="space-y-8">
          {/* Sintesi */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Riquadro etichetta="Incasso" valore={euro(dati.incassoCents)} />
            <Riquadro etichetta="Appuntamenti" valore={String(dati.nCompletati)} />
            <Riquadro etichetta="Scontrino medio" valore={euro(dati.scontrinoMedioCents)} />
            <Riquadro etichetta="Valore medio cliente" valore={euro(dati.valoreMedioClienteCents)} />
            <Riquadro etichetta="No-show" valore={pct(dati.tassoNoShow)} accento />
            <Riquadro etichetta="Cancellazioni" valore={pct(dati.tassoCancellazione)} />
            <Riquadro etichetta="Ore lavorate" valore={`${dati.oreLavorate} h`} />
            <Riquadro
              etichetta="Nuovi / di ritorno"
              valore={`${dati.nuoviClienti} / ${dati.clientiRitorno}`}
            />
          </div>

          {/* Riempimento per giorno */}
          <Sezione titolo="Riempimento per giorno" sottotitolo="Ore occupate sulle ore disponibili.">
            <Barre
              voci={dati.perGiorno.map((g) => ({
                nome: g.nome,
                valore: g.occupazione,
                etichetta: pct(g.occupazione),
              }))}
              max={1}
            />
          </Sezione>

          {/* Ore di punta */}
          <Sezione titolo="Ore di punta" sottotitolo="Appuntamenti per ora d'inizio.">
            <BarreMensili
              voci={dati.perFasciaOraria.map((f) => ({ nome: `${f.ora}`, valore: f.n }))}
              formato={(v) => `${v}`}
            />
          </Sezione>

          {/* Stagionalità */}
          <Sezione titolo="Stagionalità" sottotitolo="Incasso per mese.">
            <BarreMensili
              voci={dati.perMese.map((m) => ({ nome: m.etichetta, valore: m.incassoCents }))}
            />
          </Sezione>

          {/* Resa per servizio */}
          <Sezione titolo="Resa per servizio" sottotitolo="Incasso e numero di appuntamenti.">
            <Barre
              voci={dati.perServizio.map((s) => ({
                nome: s.nome,
                valore: s.incassoCents,
                etichetta: `${euro(s.incassoCents)} · ${s.n}`,
              }))}
              max={Math.max(1, ...dati.perServizio.map((s) => s.incassoCents))}
            />
          </Sezione>

          {/* Per operatore */}
          <Sezione titolo="Per operatore" sottotitolo="Impiego, incasso e redditività.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sabbia text-left text-xs uppercase tracking-wide text-inchiostro/50">
                    <th className="py-2 pr-2 font-medium">Operatore</th>
                    <th className="py-2 px-2 text-right font-medium">Impiego</th>
                    <th className="py-2 px-2 text-right font-medium">Incasso</th>
                    <th className="py-2 px-2 text-right font-medium">€/ora</th>
                    <th className="py-2 px-2 text-right font-medium">Scontrino</th>
                    <th className="py-2 px-2 text-right font-medium">Clienti</th>
                    <th className="py-2 pl-2 text-right font-medium">No-show</th>
                  </tr>
                </thead>
                <tbody>
                  {dati.perOperatore.map((o) => (
                    <tr key={o.id} className="border-b border-sabbia/60">
                      <td className="py-2 pr-2 font-medium">{o.nome}</td>
                      <td className="py-2 px-2 text-right">
                        <span className="inline-flex items-center gap-2">
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-sabbia sm:inline-block">
                            <span
                              className="block h-full rounded-full bg-terracotta"
                              style={{ width: pct(Math.min(1, o.impiego)) }}
                            />
                          </span>
                          <span className="tabular-nums">{pct(o.impiego)}</span>
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{euro(o.incassoCents)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{euro(o.resaOrariaCents)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{euro(o.scontrinoMedioCents)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{o.clientiUnici}</td>
                      <td className="py-2 pl-2 text-right tabular-nums">{pct(o.tassoNoShow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sezione>

          {/* Canale di prenotazione */}
          <Sezione titolo="Come prenotano" sottotitolo="Canale delle prenotazioni.">
            <Barre
              voci={dati.perCanale.map((c) => ({
                nome: c.canale,
                valore: c.n,
                etichetta: String(c.n),
              }))}
              max={Math.max(1, ...dati.perCanale.map((c) => c.n))}
            />
          </Sezione>

          {/* Migliori clienti */}
          <Sezione titolo="Migliori clienti" sottotitolo="Per valore nel periodo.">
            <ElencoClienti
              voci={dati.topClienti.map((c) => ({
                id: c.id,
                nome: c.nome,
                destra: `${euro(c.incassoCents)} · ${c.n} appunt.`,
              }))}
            />
          </Sezione>

          {/* Clienti da recuperare */}
          {dati.clientiDaRecuperare.length > 0 && (
            <Sezione
              titolo="Da recuperare"
              sottotitolo="Clienti abituali che non tornano da un po'."
            >
              <ElencoClienti
                voci={dati.clientiDaRecuperare.map((c) => ({
                  id: c.id,
                  nome: c.nome,
                  destra: `${c.giorni} gg fa · ${euro(c.valoreCents)} spesi`,
                }))}
              />
            </Sezione>
          )}

          {/* Clienti inaffidabili */}
          {dati.clientiInaffidabili.length > 0 && (
            <Sezione
              titolo="Alto tasso di no-show"
              sottotitolo="Candidati a chiedere un acconto alla prenotazione."
            >
              <ElencoClienti
                voci={dati.clientiInaffidabili.map((c) => ({
                  id: c.id,
                  nome: c.nome,
                  destra: `${pct(c.tassoNoShow)} su ${c.n} appunt.`,
                  accento: true,
                }))}
              />
            </Sezione>
          )}
        </div>
      )}
    </main>
  );
}

function Riquadro({ etichetta, valore, accento }: { etichetta: string; valore: string; accento?: boolean }) {
  return (
    <div className="rounded-xl border border-sabbia bg-white/60 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-inchiostro/50">{etichetta}</p>
      <p className={`mt-1 font-display text-2xl ${accento ? 'text-terracotta' : ''}`}>{valore}</p>
    </div>
  );
}

function Sezione({
  titolo,
  sottotitolo,
  children,
}: {
  titolo: string;
  sottotitolo: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl">{titolo}</h2>
      <p className="mb-3 text-sm text-inchiostro/50">{sottotitolo}</p>
      {children}
    </section>
  );
}

// Barre orizzontali a serie singola (terracotta su traccia sabbia).
function Barre({ voci, max }: { voci: { nome: string; valore: number; etichetta: string }[]; max: number }) {
  return (
    <div className="space-y-2">
      {voci.map((v, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-sm text-inchiostro/70">{v.nome}</span>
          <span className="h-5 flex-1 overflow-hidden rounded-md bg-sabbia">
            <span
              className="block h-full rounded-md bg-terracotta"
              style={{ width: `${Math.max(2, (v.valore / max) * 100)}%` }}
            />
          </span>
          <span className="w-28 shrink-0 text-right text-sm tabular-nums text-inchiostro/70">
            {v.etichetta}
          </span>
        </div>
      ))}
    </div>
  );
}

// Barre verticali (stagionalità mensile, ore di punta).
function BarreMensili({
  voci,
  formato = euro,
}: {
  voci: { nome: string; valore: number }[];
  formato?: (v: number) => string;
}) {
  const max = Math.max(1, ...voci.map((v) => v.valore));
  // L'area delle barre ha un'altezza fissa e propria (items-end da sola
  // non basta: senza un'altezza esplicita sulla colonna, l'altezza in %
  // della barra non ha nulla a cui riferirsi e collassa a 0). Le etichette
  // vivono in una riga separata sotto, così non intaccano l'altezza dell'area.
  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-end gap-1.5" style={{ height: 140 }}>
        {voci.map((v, i) => (
          <div key={i} className="flex h-full min-w-[28px] flex-1 items-end">
            <span
              className="w-full rounded-t-md bg-terracotta"
              style={{ height: `${Math.max(2, (v.valore / max) * 100)}%` }}
              title={formato(v.valore)}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {voci.map((v, i) => (
          <span
            key={i}
            className="min-w-[28px] flex-1 whitespace-nowrap text-center text-[10px] capitalize text-inchiostro/50"
          >
            {v.nome}
          </span>
        ))}
      </div>
    </div>
  );
}

// Elenco cliente + valore a destra (usato da più sezioni). Il nome
// collega alla scheda del cliente quando è disponibile il suo id.
function ElencoClienti({
  voci,
}: {
  voci: { id?: string; nome: string; destra: string; accento?: boolean }[];
}) {
  return (
    <ul className="space-y-1.5">
      {voci.map((v, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between border-b border-sabbia/60 py-1.5 text-sm"
        >
          {v.id ? (
            <Link
              href={`/admin/clienti/${v.id}`}
              className="truncate text-terracotta hover:underline"
            >
              {v.nome}
            </Link>
          ) : (
            <span className="truncate">{v.nome}</span>
          )}
          <span
            className={`ml-3 shrink-0 tabular-nums ${v.accento ? 'text-terracotta' : 'text-inchiostro/70'}`}
          >
            {v.destra}
          </span>
        </li>
      ))}
    </ul>
  );
}
