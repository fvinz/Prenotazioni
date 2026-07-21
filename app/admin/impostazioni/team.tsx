'use client';

// Gestione del team: aggiunta, rinomina e attivazione/disattivazione
// degli operatori. Niente eliminazione (le prenotazioni li referenziano).

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { CAMPO, type Salone } from '../comuni';
import type { Operatore } from './page';

export function SezioneTeam(props: {
  salone: Salone;
  operatori: Operatore[];
  onRicarica: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const [inModifica, setInModifica] = useState<string | null>(null);
  const [nuovoNome, setNuovoNome] = useState('');
  const [nomeNuovo, setNomeNuovo] = useState('');
  const [errore, setErrore] = useState<string | null>(null);

  async function aggiungi(e: React.FormEvent) {
    e.preventDefault();
    if (!nomeNuovo.trim()) return;
    const { error } = await supabase
      .from('operators')
      .insert({ tenant_id: props.salone.id, name: nomeNuovo.trim() });
    if (error) return setErrore('Non sono riuscito ad aggiungere. Riprova.');
    setNomeNuovo('');
    setErrore(null);
    props.onRicarica();
  }

  async function rinomina(id: string) {
    if (!nuovoNome.trim()) return;
    const { error } = await supabase
      .from('operators')
      .update({ name: nuovoNome.trim() })
      .eq('id', id);
    if (error) return setErrore('Non sono riuscito a rinominare. Riprova.');
    setInModifica(null);
    setErrore(null);
    props.onRicarica();
  }

  async function attivaDisattiva(op: Operatore) {
    const { error } = await supabase
      .from('operators')
      .update({ active: !op.active })
      .eq('id', op.id);
    if (!error) props.onRicarica();
  }

  return (
    <section>
      <h2 className="mb-2 font-display text-2xl">Team</h2>
      <ul className="space-y-2">
        {props.operatori.map((o) => (
          <li
            key={o.id}
            className={`flex items-center justify-between gap-3 rounded-xl border border-sabbia bg-white/60 px-4 py-3 ${
              o.active ? '' : 'opacity-50'
            }`}
          >
            {inModifica === o.id ? (
              <>
                <input
                  value={nuovoNome}
                  onChange={(e) => setNuovoNome(e.target.value)}
                  className={CAMPO}
                  autoFocus
                />
                <span className="flex shrink-0 gap-2 text-sm">
                  <button onClick={() => rinomina(o.id)} className="text-terracotta hover:underline">
                    Salva
                  </button>
                  <button
                    onClick={() => setInModifica(null)}
                    className="text-inchiostro/60 hover:underline"
                  >
                    Annulla
                  </button>
                </span>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate font-medium">
                  {o.name}
                  {!o.active && <span className="text-inchiostro/50"> · disattivato</span>}
                </span>
                <span className="flex shrink-0 gap-3 text-sm">
                  <button
                    onClick={() => {
                      setInModifica(o.id);
                      setNuovoNome(o.name);
                    }}
                    className="text-terracotta hover:underline"
                  >
                    Rinomina
                  </button>
                  <button
                    onClick={() => attivaDisattiva(o)}
                    className="text-inchiostro/60 hover:underline"
                  >
                    {o.active ? 'Disattiva' : 'Riattiva'}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={aggiungi} className="mt-2 flex gap-2">
        <input
          value={nomeNuovo}
          onChange={(e) => setNomeNuovo(e.target.value)}
          placeholder="Nome del nuovo operatore"
          className={CAMPO}
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-terracotta px-4 py-2 text-sm font-semibold text-crema transition hover:opacity-90"
        >
          Aggiungi
        </button>
      </form>
      {errore && <p className="mt-1 text-sm text-terracotta">{errore}</p>}
    </section>
  );
}
