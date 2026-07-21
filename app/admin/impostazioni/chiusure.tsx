'use client';

// Chiusure e ferie (time_off): dell'intero salone o di un singolo
// operatore. Bloccano gli slot del widget nel periodo indicato.

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { CAMPO, type Salone } from '../comuni';
import type { Operatore } from './page';

interface Chiusura {
  id: string;
  operator_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export function SezioneChiusure(props: { salone: Salone; operatori: Operatore[] }) {
  const supabase = getSupabaseBrowserClient();
  const [chiusure, setChiusure] = useState<Chiusura[]>([]);
  const [errore, setErrore] = useState<string | null>(null);

  const carica = useCallback(async () => {
    const { data: rows } = await supabase
      .from('time_off')
      .select('id, operator_id, starts_at, ends_at, reason')
      .eq('tenant_id', props.salone.id)
      .gte('ends_at', DateTime.utc().toISO())
      .order('starts_at');
    setChiusure((rows ?? []) as Chiusura[]);
  }, [supabase, props.salone.id]);

  useEffect(() => {
    carica();
  }, [carica]);

  async function aggiungi(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrore(null);
    const form = e.currentTarget;
    const dati = new FormData(form);
    const zona = { zone: props.salone.timezone };
    const inizio = DateTime.fromISO(String(dati.get('dal')), zona);
    const fine = DateTime.fromISO(String(dati.get('al')), zona);
    const { error } = await supabase.from('time_off').insert({
      tenant_id: props.salone.id,
      operator_id: String(dati.get('operatore')) || null,
      starts_at: inizio.toUTC().toISO(),
      ends_at: fine.toUTC().toISO(),
      reason: String(dati.get('motivo')).trim() || null,
    });
    if (error) {
      setErrore('Periodo non valido: la fine deve seguire l’inizio.');
      return;
    }
    form.reset();
    carica();
  }

  async function rimuovi(id: string) {
    const { error } = await supabase.from('time_off').delete().eq('id', id);
    if (!error) carica();
  }

  const quando = (iso: string) =>
    DateTime.fromISO(iso).setZone(props.salone.timezone).setLocale('it').toFormat('d LLL HH:mm');

  return (
    <section>
      <h2 className="mb-2 font-display text-2xl">Chiusure e ferie</h2>
      {chiusure.length === 0 ? (
        <p className="rounded-xl bg-white/60 p-4 text-center text-sm text-inchiostro/60">
          Nessuna chiusura in programma.
        </p>
      ) : (
        <ul className="space-y-2">
          {chiusure.map((c) => (
            <li
              key={c.id}
              className="flex items-baseline justify-between gap-3 rounded-xl border border-sabbia bg-white/60 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {c.operator_id
                    ? props.operatori.find((o) => o.id === c.operator_id)?.name ?? 'Operatore'
                    : 'Tutto il salone'}
                  {c.reason && <span className="font-normal text-inchiostro/60"> · {c.reason}</span>}
                </p>
                <p className="font-mono text-xs text-inchiostro/50">
                  {quando(c.starts_at)} → {quando(c.ends_at)}
                </p>
              </div>
              <button
                onClick={() => rimuovi(c.id)}
                className="shrink-0 text-sm text-terracotta hover:underline"
              >
                Rimuovi
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={aggiungi} className="mt-3 space-y-2 rounded-xl border border-sabbia p-3">
        <select name="operatore" defaultValue="" className={CAMPO} aria-label="Chi si ferma">
          <option value="">Tutto il salone</option>
          {props.operatori.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <label className="flex-1 text-sm">
            Dal
            <input name="dal" type="datetime-local" required className={CAMPO} />
          </label>
          <label className="flex-1 text-sm">
            Al
            <input name="al" type="datetime-local" required className={CAMPO} />
          </label>
        </div>
        <input name="motivo" placeholder="Motivo (facoltativo, es. ferie)" className={CAMPO} />
        {errore && <p className="text-sm text-terracotta">{errore}</p>}
        <button
          type="submit"
          className="rounded-xl bg-terracotta px-4 py-2 text-sm font-semibold text-crema transition hover:opacity-90"
        >
          Aggiungi chiusura
        </button>
      </form>
    </section>
  );
}
