'use client';

// Orari settimanali: per singolo operatore oppure per "Tutto il team"
// (la fascia si applica a tutti gli operatori attivi in un colpo solo).
// weekday in convenzione Postgres (0=domenica ... 6=sabato), mostrato
// però da lunedì a domenica come ci si aspetta in Italia.

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { type Salone } from '../comuni';
import type { Fascia, Operatore } from './page';

const GIORNI: { weekday: number; nome: string }[] = [
  { weekday: 1, nome: 'Lunedì' },
  { weekday: 2, nome: 'Martedì' },
  { weekday: 3, nome: 'Mercoledì' },
  { weekday: 4, nome: 'Giovedì' },
  { weekday: 5, nome: 'Venerdì' },
  { weekday: 6, nome: 'Sabato' },
  { weekday: 0, nome: 'Domenica' },
];

const TUTTI = '__tutti__';

export function SezioneOrari(props: {
  salone: Salone;
  operatori: Operatore[];
  fasce: Fascia[];
  /** Da un link diretto (es. dalla griglia agenda): apre già su questo operatore. */
  operatorePreselezionato?: string;
  onRicarica: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const [selezione, setSelezione] = useState(props.operatorePreselezionato ?? TUTTI);
  const [errore, setErrore] = useState<string | null>(null);

  const attivi = props.operatori.filter((o) => o.active);
  const idAttivi = new Set(attivi.map((o) => o.id));

  async function aggiungi(e: React.FormEvent<HTMLFormElement>, weekday: number) {
    e.preventDefault();
    setErrore(null);
    const form = new FormData(e.currentTarget);
    const dalle = String(form.get('dalle'));
    const alle = String(form.get('alle'));
    const destinatari = selezione === TUTTI ? attivi.map((o) => o.id) : [selezione];
    const { error } = await supabase.from('availability').insert(
      destinatari.map((operatorId) => ({
        tenant_id: props.salone.id,
        operator_id: operatorId,
        weekday,
        start_time: dalle,
        end_time: alle,
      })),
    );
    if (error) {
      setErrore('Fascia non valida: l’orario di fine deve seguire quello di inizio.');
      return;
    }
    props.onRicarica();
  }

  async function rimuovi(ids: string[]) {
    const { error } = await supabase.from('availability').delete().in('id', ids);
    if (!error) props.onRicarica();
  }

  const hm = (t: string) => t.slice(0, 5);

  /** Le fasce da mostrare per un giorno, raggruppate se "Tutto il team". */
  function fasceDelGiorno(weekday: number): { etichetta: string; ids: string[] }[] {
    if (selezione !== TUTTI) {
      return props.fasce
        .filter((f) => f.operator_id === selezione && f.weekday === weekday)
        .map((f) => ({ etichetta: `${hm(f.start_time)}–${hm(f.end_time)}`, ids: [f.id] }));
    }
    // Gruppo per orario identico tra gli operatori attivi; se non copre
    // tutto il team, l'etichetta lo dice (es. "· 2/3").
    const gruppi = new Map<string, { etichetta: string; ids: string[]; conta: number }>();
    for (const f of props.fasce) {
      if (f.weekday !== weekday || !idAttivi.has(f.operator_id)) continue;
      const chiave = `${f.start_time}|${f.end_time}`;
      const gruppo = gruppi.get(chiave) ?? {
        etichetta: `${hm(f.start_time)}–${hm(f.end_time)}`,
        ids: [],
        conta: 0,
      };
      gruppo.ids.push(f.id);
      gruppo.conta += 1;
      gruppi.set(chiave, gruppo);
    }
    return [...gruppi.values()].map((g) => ({
      etichetta:
        g.conta === attivi.length ? g.etichetta : `${g.etichetta} · ${g.conta}/${attivi.length}`,
      ids: g.ids,
    }));
  }

  return (
    <section id="orari">
      <h2 className="mb-2 font-display text-2xl">Orari</h2>
      <select
        value={selezione}
        onChange={(e) => setSelezione(e.target.value)}
        className="mb-3 w-full rounded-xl border border-sabbia bg-carta/60 px-4 py-2 outline-none transition focus:border-terracotta focus:ring-2 focus:ring-terracotta/30"
        aria-label="Operatore"
      >
        <option value={TUTTI}>Tutto il team ({attivi.length} operatori)</option>
        {props.operatori.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <div className="space-y-2">
        {GIORNI.map((g) => {
          const delGiorno = fasceDelGiorno(g.weekday);
          return (
            <div
              key={g.weekday}
              className="rounded-xl border border-sabbia bg-carta/60 px-4 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="w-24 shrink-0 text-sm font-medium">{g.nome}</span>
                {delGiorno.length === 0 && (
                  <span className="text-sm text-inchiostro/40">chiuso</span>
                )}
                {delGiorno.map((f) => (
                  <span
                    key={f.ids.join(',')}
                    className="flex items-center gap-1.5 rounded-lg bg-sabbia px-2 py-0.5 font-mono text-sm"
                  >
                    {f.etichetta}
                    <button
                      onClick={() => rimuovi(f.ids)}
                      aria-label="Rimuovi fascia"
                      className="text-terracotta hover:opacity-70"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => aggiungi(e, g.weekday)}
                  className="flex items-center gap-1 text-sm"
                >
                  <input
                    name="dalle"
                    type="time"
                    required
                    className="rounded-lg border border-sabbia bg-carta/80 px-1.5 py-0.5"
                    aria-label={`${g.nome}: dalle`}
                  />
                  <span className="text-inchiostro/40">–</span>
                  <input
                    name="alle"
                    type="time"
                    required
                    className="rounded-lg border border-sabbia bg-carta/80 px-1.5 py-0.5"
                    aria-label={`${g.nome}: alle`}
                  />
                  <button type="submit" className="ml-1 font-medium text-terracotta hover:underline">
                    +
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
      {errore && <p className="mt-1 text-sm text-terracotta">{errore}</p>}
      <p className="mt-2 text-xs text-inchiostro/50">
        Con “Tutto il team” la fascia si applica a ogni operatore attivo (e la ×
        la rimuove a tutti). Le fasce valgono per il widget pubblico: le
        prenotazioni manuali dall’agenda possono comunque uscirne.
      </p>
    </section>
  );
}
