'use client';

// Gestione servizi: creazione e modifica (durata, buffer, prezzo, chi lo
// eroga, attivo/disattivo). Niente eliminazione: le prenotazioni passate
// referenziano i servizi, quindi si disattiva e basta.

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { CAMPO, type Salone } from '../comuni';
import type { Coppia, Operatore, Servizio } from './page';

const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

export function SezioneServizi(props: {
  salone: Salone;
  servizi: Servizio[];
  operatori: Operatore[];
  coppie: Coppia[];
  onRicarica: () => void;
}) {
  // 'nuovo', un id servizio, oppure null (nessun form aperto).
  const [aperto, setAperto] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const supabase = getSupabaseBrowserClient();

  async function salva(e: React.FormEvent<HTMLFormElement>, servizioId: string | null) {
    e.preventDefault();
    setErrore(null);
    const form = new FormData(e.currentTarget);
    const valori = {
      tenant_id: props.salone.id,
      name: String(form.get('nome')).trim(),
      duration_minutes: Number(form.get('durata')),
      buffer_minutes: Number(form.get('buffer') || 0),
      price_cents: Math.round(Number(String(form.get('prezzo')).replace(',', '.')) * 100),
      active: form.get('attivo') === 'on',
    };
    const operatoriScelti = props.operatori.filter((o) => form.get(`op-${o.id}`) === 'on');

    let id = servizioId;
    if (id) {
      const { error } = await supabase.from('services').update(valori).eq('id', id);
      if (error) return setErrore('Non sono riuscito a salvare. Riprova.');
    } else {
      const { data: riga, error } = await supabase
        .from('services')
        .insert(valori)
        .select('id')
        .single();
      if (error || !riga) return setErrore('Non sono riuscito a salvare. Riprova.');
      id = riga.id;
    }

    // Associazioni: si riscrivono per intero (pochi dati, zero ambiguità).
    await supabase.from('operator_services').delete().eq('service_id', id);
    if (operatoriScelti.length > 0) {
      const { error } = await supabase
        .from('operator_services')
        .insert(operatoriScelti.map((o) => ({ operator_id: o.id, service_id: id })));
      if (error) return setErrore('Servizio salvato, ma non le associazioni. Riprova.');
    }
    setAperto(null);
    props.onRicarica();
  }

  function Form({ servizio }: { servizio: Servizio | null }) {
    const erogatoDa = new Set(
      props.coppie.filter((c) => c.service_id === servizio?.id).map((c) => c.operator_id),
    );
    return (
      <form
        onSubmit={(e) => salva(e, servizio?.id ?? null)}
        className="space-y-3 rounded-xl border border-terracotta/50 bg-white/60 p-4"
      >
        <input
          name="nome"
          required
          defaultValue={servizio?.name}
          placeholder="Nome del servizio"
          className={CAMPO}
        />
        <div className="flex gap-2">
          <label className="flex-1 text-sm">
            Durata (min)
            <input
              name="durata"
              type="number"
              min={5}
              step={5}
              required
              defaultValue={servizio?.duration_minutes ?? 30}
              className={CAMPO}
            />
          </label>
          <label className="flex-1 text-sm">
            Buffer (min)
            <input
              name="buffer"
              type="number"
              min={0}
              step={5}
              defaultValue={servizio?.buffer_minutes ?? 0}
              className={CAMPO}
            />
          </label>
          <label className="flex-1 text-sm">
            Prezzo (€)
            <input
              name="prezzo"
              type="number"
              min={0}
              step="0.5"
              required
              defaultValue={servizio ? servizio.price_cents / 100 : ''}
              className={CAMPO}
            />
          </label>
        </div>
        <div>
          <p className="mb-1 text-sm">Erogato da:</p>
          <div className="flex flex-wrap gap-3">
            {props.operatori.map((o) => (
              <label key={o.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name={`op-${o.id}`}
                  defaultChecked={servizio ? erogatoDa.has(o.id) : true}
                  className="accent-terracotta"
                />
                {o.name}
              </label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name="attivo"
            defaultChecked={servizio?.active ?? true}
            className="accent-terracotta"
          />
          Attivo (prenotabile dal widget)
        </label>
        {errore && <p className="text-sm text-terracotta">{errore}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-xl bg-terracotta px-4 py-2 text-sm font-semibold text-crema transition hover:opacity-90"
          >
            Salva
          </button>
          <button
            type="button"
            onClick={() => setAperto(null)}
            className="rounded-xl px-4 py-2 text-sm text-inchiostro/70 hover:underline"
          >
            Annulla
          </button>
        </div>
      </form>
    );
  }

  return (
    <section>
      <h2 className="mb-2 font-display text-2xl">Servizi</h2>
      <ul className="space-y-2">
        {props.servizi.map((s) => (
          <li key={s.id}>
            {aperto === s.id ? (
              <Form servizio={s} />
            ) : (
              <div
                className={`flex items-baseline justify-between rounded-xl border border-sabbia bg-white/60 px-4 py-3 ${
                  s.active ? '' : 'opacity-50'
                }`}
              >
                <span className="min-w-0 truncate font-medium">
                  {s.name}
                  {!s.active && <span className="text-inchiostro/50"> · disattivato</span>}
                </span>
                <span className="ml-3 flex shrink-0 items-baseline gap-3">
                  <span className="font-mono text-sm text-inchiostro/60">
                    {s.duration_minutes}
                    {s.buffer_minutes > 0 && `+${s.buffer_minutes}`} min · {euro(s.price_cents)}
                  </span>
                  <button
                    onClick={() => setAperto(s.id)}
                    className="text-sm text-terracotta hover:underline"
                  >
                    Modifica
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
        <li>
          {aperto === 'nuovo' ? (
            <Form servizio={null} />
          ) : (
            <button
              onClick={() => setAperto('nuovo')}
              className="text-sm font-medium text-terracotta hover:underline"
            >
              + Nuovo servizio
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}
