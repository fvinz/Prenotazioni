'use client';

// Impostazioni del salone (solo titolare): servizi, team, orari, chiusure.
// L'interfaccia nasconde la sezione allo staff, ma la vera barriera sono
// le policy RLS della migration 0005: le scritture passano solo da owner.

import { useCallback, useEffect, useState } from 'react';
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

export default function ImpostazioniAdmin() {
  const supabase = getSupabaseBrowserClient();
  const { salone, ruolo, errore } = useSalone();

  const [operatori, setOperatori] = useState<Operatore[]>([]);
  const [servizi, setServizi] = useState<Servizio[]>([]);
  const [fasce, setFasce] = useState<Fascia[]>([]);
  const [coppie, setCoppie] = useState<Coppia[]>([]);
  const [caricato, setCaricato] = useState(false);

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
        <div className="space-y-10">
          <SezioneServizi
            salone={salone}
            servizi={servizi}
            operatori={operatori}
            coppie={coppie}
            onRicarica={ricarica}
          />
          <SezioneTeam salone={salone} operatori={operatori} onRicarica={ricarica} />
          <SezioneOrari salone={salone} operatori={operatori} fasce={fasce} onRicarica={ricarica} />
          <SezioneChiusure salone={salone} operatori={operatori} />
        </div>
      )}
    </main>
  );
}
