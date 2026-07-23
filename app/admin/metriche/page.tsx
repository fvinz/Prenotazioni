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
import { generaConsigli, type Consiglio } from '@/lib/consigli';
import { Intestazione, useSalone } from '../comuni';

// Quanto resta silenziato un consiglio ignorato prima di poter ricomparire.
const GIORNI_IGNORA = 30;

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
  const [precedente, setPrecedente] = useState<Metriche | null>(null);
  const [consigli, setConsigli] = useState<Consiglio[]>([]);
  const [erroreDati, setErroreDati] = useState<string | null>(null);

  // Prenotazioni di un intervallo [dallIso, aIso), a pagine (superano il
  // limite di 1000 righe di una singola richiesta).
  const caricaPrenotazioni = useCallback(
    async (tenantId: string, dallIso: string, aIso?: string): Promise<Prenotazione[] | null> => {
      const bookings: Prenotazione[] = [];
      const PAGINA = 1000;
      for (let inizio = 0; ; inizio += PAGINA) {
        let query = supabase
          .from('bookings')
          .select('operator_id, service_id, customer_id, starts_at, ends_at, status, price_cents, source')
          .eq('tenant_id', tenantId)
          .gte('starts_at', dallIso);
        if (aIso) query = query.lt('starts_at', aIso);
        const { data: rows, error } = await query.order('starts_at').range(inizio, inizio + PAGINA - 1);
        if (error) return null;
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
      return bookings;
    },
    [supabase],
  );

  const carica = useCallback(async () => {
    if (!salone || ruolo !== 'owner') return;
    setDati(null);
    setErroreDati(null);

    const oggi = DateTime.now().setZone(salone.timezone).startOf('day');
    const from = oggi.minus({ days: GIORNI_PERIODO[periodo] });
    const precInizio = from.minus({ days: GIORNI_PERIODO[periodo] });

    const [bookingsCorrente, bookingsPrecedente, opsRes, svcRes, avRes, custRes, ignoratiRes] =
      await Promise.all([
        caricaPrenotazioni(salone.id, from.toUTC().toISO()!),
        caricaPrenotazioni(salone.id, precInizio.toUTC().toISO()!, from.toUTC().toISO()!),
        supabase.from('operators').select('id, name').eq('tenant_id', salone.id).order('name'),
        supabase.from('services').select('id, name').eq('tenant_id', salone.id),
        supabase.from('availability').select('operator_id, weekday, start_time, end_time').eq('tenant_id', salone.id),
        supabase.from('customers').select('id, first_name, last_name, phone, created_at').eq('tenant_id', salone.id),
        supabase
          .from('consigli_ignorati')
          .select('identificativo')
          .eq('tenant_id', salone.id)
          .gt('ignorato_fino', DateTime.utc().toISO()),
      ]);

    if (bookingsCorrente === null || bookingsPrecedente === null) {
      setErroreDati('Non riesco a caricare le metriche. Riprova.');
      return;
    }

    const nomiClienti: Record<string, string> = {};
    const clientiCreatoIl: Record<string, string> = {};
    const telefoniClienti: Record<string, string> = {};
    for (const c of custRes.data ?? []) {
      nomiClienti[c.id] = `${c.first_name} ${c.last_name ?? ''}`.trim();
      clientiCreatoIl[c.id] = c.created_at;
      if (c.phone) telefoniClienti[c.id] = c.phone;
    }

    const operatori = opsRes.data ?? [];
    const servizi = svcRes.data ?? [];
    const disponibilita = (avRes.data ?? []).map((a) => ({
      operatorId: a.operator_id,
      weekday: a.weekday,
      startMin: minutiDaOra(String(a.start_time)),
      endMin: minutiDaOra(String(a.end_time)),
    }));

    const metricheCorrente = calcolaMetriche({
      from: from.toISODate()!,
      to: oggi.toISODate()!,
      timezone: salone.timezone,
      bookings: bookingsCorrente,
      operatori,
      servizi,
      disponibilita,
      nomiClienti,
      clientiCreatoIl,
      telefoniClienti,
    });
    const metrichePrecedente = calcolaMetriche({
      from: precInizio.toISODate()!,
      to: from.minus({ days: 1 }).toISODate()!,
      timezone: salone.timezone,
      bookings: bookingsPrecedente,
      operatori,
      servizi,
      disponibilita,
      nomiClienti,
      clientiCreatoIl,
      telefoniClienti,
    });

    setDati(metricheCorrente);
    setPrecedente(metrichePrecedente);

    const ignorati = new Set((ignoratiRes.data ?? []).map((r) => r.identificativo as string));
    setConsigli(
      generaConsigli({
        corrente: metricheCorrente,
        precedente: metrichePrecedente,
        ignorati,
        hrefRecupero: '/admin/metriche#da-recuperare',
        urlWidget: `${window.location.origin}/${salone.slug}`,
      }),
    );
  }, [supabase, salone, ruolo, periodo, caricaPrenotazioni]);

  useEffect(() => {
    carica();
  }, [carica]);

  async function ignoraConsiglio(id: string) {
    if (!salone) return;
    setConsigli((prev) => prev.filter((c) => c.id !== id));
    await supabase.from('consigli_ignorati').upsert(
      {
        tenant_id: salone.id,
        identificativo: id,
        ignorato_fino: DateTime.utc().plus({ days: GIORNI_IGNORA }).toISO(),
      },
      { onConflict: 'tenant_id,identificativo' },
    );
  }

  async function applicaPrezzo(consiglioId: string, servizioId: string, nuovoCents: number): Promise<boolean> {
    if (!salone) return false;
    const { error } = await supabase.from('services').update({ price_cents: nuovoCents }).eq('id', servizioId);
    if (error) return false;
    // Il prezzo cambia da ora in poi: i dati del periodo restano quelli
    // registrati, quindi il consiglio non si spegnerebbe da solo. Lo
    // silenziamo esplicitamente, come un "fatto".
    await ignoraConsiglio(consiglioId);
    carica();
    return true;
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
          {/* Consigli per te */}
          {consigli.length > 0 && (
            <section>
              <h2 className="font-display text-xl">Consigli per te</h2>
              <p className="mb-3 text-sm text-inchiostro/50">
                Letture dei tuoi numeri, non regole fisse: ignora quelli che non ti servono.
              </p>
              <div className="space-y-2">
                {consigli.map((c) => (
                  <ConsiglioCard
                    key={c.id}
                    consiglio={c}
                    onIgnora={() => ignoraConsiglio(c.id)}
                    onApplicaPrezzo={(nuovoCents) => {
                      if (c.azione?.kind !== 'modifica_prezzo') return Promise.resolve(false);
                      return applicaPrezzo(c.id, c.azione.servizioId, nuovoCents);
                    }}
                  />
                ))}
              </div>
            </section>
          )}

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
          <Sezione id="per-operatore" titolo="Per operatore" sottotitolo="Impiego, incasso e redditività.">
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
              id="da-recuperare"
              titolo="Da recuperare"
              sottotitolo="Clienti abituali che non tornano da un po'."
            >
              <ElencoClienti
                voci={dati.clientiDaRecuperare.map((c) => ({
                  id: c.id,
                  nome: c.nome,
                  destra: `${c.giorni} gg fa · ${euro(c.valoreCents)} spesi`,
                  whatsapp: c.telefono
                    ? {
                        telefono: c.telefono,
                        messaggio: `Ciao ${c.nome}, è da un po' che non ti vediamo da ${salone.name}! Se vuoi prenotare un appuntamento siamo qui.`,
                      }
                    : undefined,
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
  id,
  titolo,
  sottotitolo,
  children,
}: {
  id?: string;
  titolo: string;
  sottotitolo: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={id ? 'scroll-mt-4' : undefined}>
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
// collega alla scheda del cliente quando è disponibile il suo id; un
// numero di telefono aggiunge un collegamento WhatsApp pronto.
function ElencoClienti({
  voci,
}: {
  voci: {
    id?: string;
    nome: string;
    destra: string;
    accento?: boolean;
    whatsapp?: { telefono: string; messaggio: string };
  }[];
}) {
  return (
    <ul className="space-y-1.5">
      {voci.map((v, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between gap-2 border-b border-sabbia/60 py-1.5 text-sm"
        >
          <span className="flex min-w-0 items-baseline gap-2">
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
            {v.whatsapp && (
              <a
                href={`https://wa.me/${v.whatsapp.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(v.whatsapp.messaggio)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-inchiostro/50 hover:text-terracotta hover:underline"
              >
                WhatsApp
              </a>
            )}
          </span>
          <span
            className={`shrink-0 tabular-nums ${v.accento ? 'text-terracotta' : 'text-inchiostro/70'}`}
          >
            {v.destra}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Scheda di un consiglio: tipo, testo, l'azione rapida quando esiste, e
// un modo per ignorarlo (silenziato per un periodo prima di ricomparire).
function ConsiglioCard({
  consiglio,
  onIgnora,
  onApplicaPrezzo,
}: {
  consiglio: Consiglio;
  onIgnora: () => void;
  onApplicaPrezzo: (nuovoCents: number) => Promise<boolean>;
}) {
  const [modificaPrezzo, setModificaPrezzo] = useState(false);
  const [copiato, setCopiato] = useState(false);
  const [invio, setInvio] = useState(false);
  // Estratto in una costante: il restringimento di tipo su 'kind' non
  // attraversa gli accessi ripetuti a una proprietà opzionale dentro le
  // funzioni di callback, ma su una variabile locale sì.
  const azione = consiglio.azione;

  const bordo =
    consiglio.tipo === 'attenzione'
      ? 'border-terracotta/60'
      : consiglio.tipo === 'positivo'
        ? 'border-sabbia'
        : 'border-inchiostro/15';

  async function copia(testo: string) {
    await navigator.clipboard.writeText(testo);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
  }

  async function salvaPrezzo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (consiglio.azione?.kind !== 'modifica_prezzo') return;
    const form = new FormData(e.currentTarget);
    const euroInput = Number(String(form.get('prezzo')).replace(',', '.'));
    if (!euroInput || euroInput <= 0) return;
    setInvio(true);
    const ok = await onApplicaPrezzo(Math.round(euroInput * 100));
    setInvio(false);
    if (ok) setModificaPrezzo(false);
  }

  return (
    <div className={`rounded-xl border bg-white/60 px-4 py-3 ${bordo}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{consiglio.titolo}</p>
          <p className="mt-0.5 text-sm text-inchiostro/70">{consiglio.testo}</p>
        </div>
        <button
          onClick={onIgnora}
          aria-label="Ignora questo consiglio"
          title="Ignora per un mese"
          className="shrink-0 text-inchiostro/40 hover:text-terracotta"
        >
          ×
        </button>
      </div>

      {azione && !modificaPrezzo && (
        <div className="mt-2">
          {azione.kind === 'naviga' && (
            <Link href={azione.href} className="text-sm font-medium text-terracotta hover:underline">
              {azione.etichetta} →
            </Link>
          )}
          {azione.kind === 'whatsapp' && (
            <a
              href={`https://wa.me/${azione.telefono.replace(/\D/g, '')}?text=${encodeURIComponent(azione.messaggio)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-terracotta hover:underline"
            >
              {azione.etichetta} →
            </a>
          )}
          {azione.kind === 'copia' && (
            <button
              onClick={() => copia(azione.testo)}
              className="text-sm font-medium text-terracotta hover:underline"
            >
              {copiato ? 'Copiato ✓' : azione.etichetta}
            </button>
          )}
          {azione.kind === 'modifica_prezzo' && (
            <button
              onClick={() => setModificaPrezzo(true)}
              className="text-sm font-medium text-terracotta hover:underline"
            >
              {azione.etichetta} →
            </button>
          )}
        </div>
      )}

      {azione?.kind === 'modifica_prezzo' && modificaPrezzo && (
        <form onSubmit={salvaPrezzo} className="mt-2 flex items-center gap-2">
          <span className="text-sm text-inchiostro/60">Nuovo prezzo di {azione.servizioNome}:</span>
          <input
            name="prezzo"
            type="number"
            min={0}
            step="0.5"
            defaultValue={azione.prezzoSuggeritoCents / 100}
            className="w-24 rounded-lg border border-sabbia bg-white/80 px-2 py-1 text-sm"
            autoFocus
          />
          <button
            type="submit"
            disabled={invio}
            className="rounded-lg bg-terracotta px-3 py-1 text-sm font-medium text-crema disabled:opacity-60"
          >
            Salva
          </button>
          <button
            type="button"
            onClick={() => setModificaPrezzo(false)}
            className="text-sm text-inchiostro/50 hover:underline"
          >
            Annulla
          </button>
        </form>
      )}
    </div>
  );
}
