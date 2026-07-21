'use client';

// Orari settimanali per operatore: fasce per giorno, con aggiunta e
// rimozione. weekday in convenzione Postgres (0=domenica ... 6=sabato),
// mostrato però da lunedì a domenica come ci si aspetta in Italia.

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

export function SezioneOrari(props: {
  salone: Salone;
  operatori: Operatore[];
  fasce: Fascia[];
  onRicarica: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const [operatoreId, setOperatoreId] = useState(props.operatori[0]?.id ?? '');
  const [errore, setErrore] = useState<string | null>(null);

  async function aggiungi(e: React.FormEvent<HTMLFormElement>, weekday: number) {
    e.preventDefault();
    setErrore(null);
    const form = new FormData(e.currentTarget);
    const dalle = String(form.get('dalle'));
    const alle = String(form.get('alle'));
    const { error } = await supabase.from('availability').insert({
      tenant_id: props.salone.id,
      operator_id: operatoreId,
      weekday,
      start_time: dalle,
      end_time: alle,
    });
    if (error) {
      setErrore('Fascia non valida: l’orario di fine deve seguire quello di inizio.');
      return;
    }
    props.onRicarica();
  }

  async function rimuovi(id: string) {
    const { error } = await supabase.from('availability').delete().eq('id', id);
    if (!error) props.onRicarica();
  }

  const hm = (t: string) => t.slice(0, 5);

  return (
    <section>
      <h2 className="mb-2 font-display text-2xl">Orari</h2>
      <select
        value={operatoreId}
        onChange={(e) => setOperatoreId(e.target.value)}
        className="mb-3 w-full rounded-xl border border-sabbia bg-white/60 px-4 py-2 outline-none transition focus:border-terracotta"
        aria-label="Operatore"
      >
        {props.operatori.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <div className="space-y-2">
        {GIORNI.map((g) => {
          const delGiorno = props.fasce.filter(
            (f) => f.operator_id === operatoreId && f.weekday === g.weekday,
          );
          return (
            <div
              key={g.weekday}
              className="rounded-xl border border-sabbia bg-white/60 px-4 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="w-24 shrink-0 text-sm font-medium">{g.nome}</span>
                {delGiorno.length === 0 && (
                  <span className="text-sm text-inchiostro/40">chiuso</span>
                )}
                {delGiorno.map((f) => (
                  <span
                    key={f.id}
                    className="flex items-center gap-1.5 rounded-lg bg-sabbia px-2 py-0.5 font-mono text-sm"
                  >
                    {hm(f.start_time)}–{hm(f.end_time)}
                    <button
                      onClick={() => rimuovi(f.id)}
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
                    className="rounded-lg border border-sabbia bg-white/80 px-1.5 py-0.5"
                    aria-label={`${g.nome}: dalle`}
                  />
                  <span className="text-inchiostro/40">–</span>
                  <input
                    name="alle"
                    type="time"
                    required
                    className="rounded-lg border border-sabbia bg-white/80 px-1.5 py-0.5"
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
        Le fasce valgono per il widget pubblico. Le prenotazioni manuali dall’agenda
        possono comunque uscirne.
      </p>
    </section>
  );
}
