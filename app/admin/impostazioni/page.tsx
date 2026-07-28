'use client';

// Impostazioni del salone (solo titolare): servizi, team, orari, chiusure.
// L'interfaccia nasconde la sezione allo staff, ma la vera barriera sono
// le policy RLS della migration 0005: le scritture passano solo da owner.

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Intestazione, useSalone } from '../comuni';
import { SezioneServizi } from './servizi';
import { SezioneTeam } from './team';
import { SezioneOrari } from './orari';
import { SezioneChiusure } from './chiusure';

export interface Operatore {
  id: string;
  name: string;
  active: boolean;
  ical_token: string;
}

export interface Servizio {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  price_cents: number;
  active: boolean;
}

export interface Fascia {
  id: string;
  operator_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface Coppia {
  operator_id: string;
  service_id: string;
}

// Le quattro sezioni erano tutte impilate in un'unica pagina lunghissima:
// ora si vede una scheda alla volta.
type Scheda = 'servizi' | 'team' | 'orari' | 'chiusure';
const ETICHETTA_SCHEDA: Record<Scheda, string> = {
  servizi: 'Servizi',
  team: 'Team',
  orari: 'Orari',
  chiusure: 'Chiusure',
};

export default function ImpostazioniAdmin() {
  return (
    <Suspense fallback={<main className="p-8 text-center text-inchiostro/60">Un attimo…</main>}>
      <Contenuto />
    </Suspense>
  );
}

function Contenuto() {
  const supabase = getSupabaseBrowserClient();
  const { salone, ruolo, errore } = useSalone();
  const parametri = useSearchParams();
  const operatorePreselezionato = parametri.get('operatore') ?? undefined;

  const [operatori, setOperatori] = useState<Operatore[]>([]);
  const [servizi, setServizi] = useState<Servizio[]>([]);
  const [fasce, setFasce] = useState<Fascia[]>([]);
  const [coppie, setCoppie] = useState<Coppia[]>([]);
  const [caricato, setCaricato] = useState(false);
  // Un link dall'agenda (es. "aggiungi orari a questo operatore") porta
  // qui con ?operatore=…: in quel caso si apre direttamente la scheda Orari.
  const [scheda, setScheda] = useState<Scheda>(operatorePreselezionato ? 'orari' : 'servizi');

  const ricarica = useCallback(async () => {
    if (!salone) return;
    const [ops, svc, av, os] = await Promise.all([
      supabase
        .from('operators')
        .select('id, name, active, ical_token')
        .eq('tenant_id', salone.id)
        .order('name'),
      supabase
        .from('services')
        .select('id, name, duration_minutes, buffer_minutes, price_cents, active')
        .eq('tenant_id', salone.id)
        .order('name'),
      supabase
        .from('availability')
        .select('id, operator_id, weekday, start_time, end_time')
        .eq('tenant_id', salone.id)
        .order('weekday')
        .order('start_time'),
      supabase.from('operator_services').select('operator_id, service_id'),
    ]);
    setOperatori((ops.data ?? []) as Operatore[]);
    setServizi((svc.data ?? []) as Servizio[]);
    setFasce((av.data ?? []) as Fascia[]);
    setCoppie(os.data ?? []);
    setCaricato(true);
  }, [supabase, salone]);

  useEffect(() => {
    ricarica();
  }, [ricarica]);

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
          Le impostazioni sono riservate al titolare del salone.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <Intestazione salone={salone} ruolo={ruolo} />
      {!caricato ? (
        <p className="text-center text-inchiostro/60">Un attimo…</p>
      ) : (
        <>
          <div className="mb-6 flex overflow-hidden rounded-lg border border-inchiostro/15 text-sm">
            {(Object.keys(ETICHETTA_SCHEDA) as Scheda[]).map((s) => (
              <button
                key={s}
                onClick={() => setScheda(s)}
                aria-current={scheda === s ? 'true' : undefined}
                className={`flex-1 px-3 py-1.5 font-medium transition ${
                  scheda === s ? 'bg-inchiostro text-crema' : 'hover:bg-carta/60'
                }`}
              >
                {ETICHETTA_SCHEDA[s]}
              </button>
            ))}
          </div>

          {scheda === 'servizi' && (
            <SezioneServizi
              salone={salone}
              servizi={servizi}
              operatori={operatori}
              coppie={coppie}
              onRicarica={ricarica}
            />
          )}
          {scheda === 'team' && (
            <SezioneTeam salone={salone} operatori={operatori} onRicarica={ricarica} />
          )}
          {scheda === 'orari' && (
            <SezioneOrari
              salone={salone}
              operatori={operatori}
              fasce={fasce}
              operatorePreselezionato={operatorePreselezionato}
              onRicarica={ricarica}
            />
          )}
          {scheda === 'chiusure' && <SezioneChiusure salone={salone} operatori={operatori} />}
        </>
      )}
    </main>
  );
}
