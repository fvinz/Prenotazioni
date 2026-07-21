'use client';

// Scheda cliente: contatti, note del salone (modificabili) e storico
// appuntamenti. Le note sono il "quaderno" dell'esercente: allergie,
// preferenze, colore usato l'ultima volta…

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { Intestazione, useSalone } from '../../comuni';

interface Cliente {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: string;
}

interface Appuntamento {
  id: string;
  starts_at: string;
  status: string;
  price_cents: number;
  services: { name: string } | null;
  operators: { name: string } | null;
}

const STATO: Record<string, string> = {
  confirmed: 'confermata',
  cancelled: 'annullata',
  completed: 'completata',
  no_show: 'no-show',
};

const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

export default function SchedaCliente() {
  const { id } = useParams<{ id: string }>();
  const supabase = getSupabaseBrowserClient();
  const { salone, errore } = useSalone();

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [storico, setStorico] = useState<Appuntamento[] | null>(null);
  const [note, setNote] = useState('');
  const [salvataggio, setSalvataggio] = useState<'idle' | 'saving' | 'saved'>('idle');

  const carica = useCallback(async () => {
    if (!salone) return;
    const [clienteRes, storicoRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, first_name, last_name, phone, email, notes, created_at')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('bookings')
        .select('id, starts_at, status, price_cents, services(name), operators(name)')
        .eq('customer_id', id)
        .order('starts_at', { ascending: false })
        .limit(50),
    ]);
    setCliente((clienteRes.data ?? null) as Cliente | null);
    setNote(clienteRes.data?.notes ?? '');
    setStorico((storicoRes.data ?? []) as unknown as Appuntamento[]);
  }, [supabase, salone, id]);

  useEffect(() => {
    carica();
  }, [carica]);

  async function salvaNote() {
    setSalvataggio('saving');
    const { error } = await supabase.from('customers').update({ notes: note || null }).eq('id', id);
    setSalvataggio(error ? 'idle' : 'saved');
    if (!error) setTimeout(() => setSalvataggio('idle'), 2000);
  }

  if (errore) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <p className="rounded-xl bg-sabbia p-4">{errore}</p>
      </main>
    );
  }
  if (!salone || storico === null) {
    return <main className="p-8 text-center text-inchiostro/60">Un attimo…</main>;
  }
  if (!cliente) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <p className="rounded-xl bg-sabbia p-4">Cliente non trovato.</p>
      </main>
    );
  }

  const dataLocale = (iso: string) =>
    DateTime.fromISO(iso).setZone(salone.timezone).setLocale('it').toFormat("ccc d LLL yyyy · HH:mm");

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8">
      <Intestazione salone={salone} />

      <Link href="/admin/clienti" className="text-sm text-terracotta hover:underline">
        ← Tutti i clienti
      </Link>

      <div className="mt-3 rounded-xl border border-sabbia bg-white/60 p-4">
        <h2 className="font-display text-2xl">
          {cliente.first_name} {cliente.last_name ?? ''}
        </h2>
        <p className="mt-1 font-mono text-sm text-inchiostro/70">
          {cliente.phone}
          {cliente.email && ` · ${cliente.email}`}
        </p>
        <p className="mt-1 text-xs text-inchiostro/50">
          Cliente dal {DateTime.fromISO(cliente.created_at).setLocale('it').toFormat('LLLL yyyy')}
        </p>
      </div>

      <section className="mt-4">
        <h3 className="mb-2 font-display text-xl">Note</h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Preferenze, allergie, colore usato…"
          className="w-full rounded-xl border border-sabbia bg-white/60 px-4 py-3 outline-none transition focus:border-terracotta"
        />
        <button
          onClick={salvaNote}
          disabled={salvataggio === 'saving'}
          className="mt-1 rounded-xl bg-terracotta px-4 py-2 text-sm font-semibold text-crema transition hover:opacity-90 disabled:opacity-60"
        >
          {salvataggio === 'saving' ? 'Un attimo…' : salvataggio === 'saved' ? 'Salvate ✓' : 'Salva note'}
        </button>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-display text-xl">Storico appuntamenti</h3>
        {storico.length === 0 ? (
          <p className="rounded-xl bg-white/60 p-4 text-center text-inchiostro/60">
            Nessun appuntamento finora.
          </p>
        ) : (
          <ul className="space-y-2">
            {storico.map((a) => (
              <li
                key={a.id}
                className={`flex items-baseline justify-between gap-3 rounded-xl border border-sabbia bg-white/60 px-4 py-2.5 ${
                  a.status === 'cancelled' ? 'opacity-50' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {a.services?.name ?? 'Servizio'}
                    <span className="font-normal text-inchiostro/60">
                      {a.operators ? ` con ${a.operators.name}` : ''}
                    </span>
                  </p>
                  <p className="font-mono text-xs capitalize text-inchiostro/50">
                    {dataLocale(a.starts_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm">{euro(a.price_cents)}</p>
                  <p className="text-xs text-inchiostro/50">{STATO[a.status] ?? a.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
