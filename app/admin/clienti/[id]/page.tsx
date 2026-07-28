'use client';

// Scheda cliente: contatti, note del salone (modificabili) e storico
// appuntamenti. Le note sono il "quaderno" dell'esercente: allergie,
// preferenze, colore usato l'ultima volta…

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { calcolaStatCliente, type Prenotazione, type StatCliente } from '@/lib/metriche';
import { ConfermaAzione, Intestazione, useSalone } from '../../comuni';

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
  operator_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
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
  const { salone, ruolo, errore } = useSalone();

  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [storico, setStorico] = useState<Appuntamento[] | null>(null);
  const [stat, setStat] = useState<StatCliente | null>(null);
  const [note, setNote] = useState('');
  const [salvataggio, setSalvataggio] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [confermaAzione, setConfermaAzione] = useState<{
    bookingId: string;
    stato: 'no_show' | 'cancelled';
  } | null>(null);

  const carica = useCallback(async () => {
    if (!salone) return;
    const [clienteRes, storicoRes, opsRes, svcRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, first_name, last_name, phone, email, notes, created_at')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('bookings')
        .select('id, operator_id, service_id, starts_at, ends_at, status, price_cents, services(name), operators(name)')
        .eq('customer_id', id)
        .order('starts_at', { ascending: false })
        .limit(500),
      supabase.from('operators').select('id, name').eq('tenant_id', salone.id),
      supabase.from('services').select('id, name').eq('tenant_id', salone.id),
    ]);
    setCliente((clienteRes.data ?? null) as Cliente | null);
    setNote(clienteRes.data?.notes ?? '');
    const righe = (storicoRes.data ?? []) as unknown as Appuntamento[];
    setStorico(righe);
    setStat(
      calcolaStatCliente({
        now: DateTime.now().toISO()!,
        operatori: opsRes.data ?? [],
        servizi: svcRes.data ?? [],
        bookings: righe.map(
          (b): Prenotazione => ({
            operatorId: b.operator_id,
            serviceId: b.service_id,
            customerId: id,
            startsAt: b.starts_at,
            endsAt: b.ends_at,
            status: b.status as Prenotazione['status'],
            priceCents: b.price_cents,
          }),
        ),
      }),
    );
  }, [supabase, salone, id]);

  useEffect(() => {
    carica();
  }, [carica]);

  function cambiaStato(bookingId: string, stato: 'completed' | 'no_show' | 'cancelled') {
    if (stato === 'completed') {
      eseguiCambiaStato(bookingId, stato);
      return;
    }
    setConfermaAzione({ bookingId, stato });
  }

  async function eseguiCambiaStato(bookingId: string, stato: 'completed' | 'no_show' | 'cancelled') {
    const { error } = await supabase
      .from('bookings')
      .update({ status: stato })
      .eq('id', bookingId);
    if (!error) carica();
  }

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
      <Intestazione salone={salone} ruolo={ruolo} />

      <Link href="/admin/clienti" className="text-sm text-terracotta hover:underline">
        ← Tutti i clienti
      </Link>

      <div className="mt-3 rounded-xl border border-sabbia bg-carta/60 p-4">
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

      {stat && stat.nCompletati > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat etichetta="Valore totale" valore={euro(stat.valoreTotaleCents)} />
          <Stat etichetta="Scontrino medio" valore={euro(stat.scontrinoMedioCents)} />
          <Stat etichetta="Appuntamenti" valore={String(stat.nCompletati)} />
          <Stat
            etichetta="No-show"
            valore={`${Math.round(stat.tassoNoShow * 100)}%`}
            accento={stat.tassoNoShow >= 0.25}
          />
          <Stat etichetta="Operatore preferito" valore={stat.operatorePreferito ?? '—'} />
          <Stat
            etichetta="Torna in media"
            valore={stat.frequenzaGiorni ? `ogni ${stat.frequenzaGiorni} gg` : '—'}
          />
          <Stat
            etichetta="Ultimo appuntamento"
            valore={stat.giorniDaUltimo !== null ? `${stat.giorniDaUltimo} gg fa` : '—'}
          />
          <Stat
            etichetta="Servizi abituali"
            valore={stat.serviziAbituali.slice(0, 2).map((s) => s.nome).join(', ') || '—'}
          />
          <Stat
            etichetta="Prossimo"
            valore={
              stat.prossimoIso
                ? DateTime.fromISO(stat.prossimoIso).setZone(salone.timezone).setLocale('it').toFormat('d LLL')
                : 'nessuno'
            }
            accento={!!stat.prossimoIso}
          />
        </div>
      )}

      <section className="mt-4">
        <h3 className="mb-2 font-display text-xl">Note</h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Preferenze, allergie, colore usato…"
          className="w-full rounded-xl border border-sabbia bg-carta/60 px-4 py-3 outline-none transition focus:border-terracotta focus:ring-2 focus:ring-terracotta/30"
        />
        <button
          onClick={salvaNote}
          disabled={salvataggio === 'saving'}
          className="mt-1 rounded-xl bg-terracotta px-4 py-2 text-sm font-semibold text-crema transition hover:opacity-90 disabled:opacity-60"
        >
          {salvataggio === 'saving' ? 'Un attimo…' : salvataggio === 'saved' ? 'Salvate ✓' : 'Salva note'}
        </button>
      </section>

      <section className="mt-10">
        <h3 className="mb-2 font-display text-xl">
          Storico appuntamenti
          {storico.length > 0 && (
            <span className="ml-2 text-sm font-normal text-inchiostro/40">{storico.length}</span>
          )}
        </h3>
        {storico.length === 0 ? (
          <p className="rounded-xl bg-carta/60 p-4 text-center text-inchiostro/60">
            Nessun appuntamento finora.
          </p>
        ) : (
          <ul className="space-y-2">
            {storico.map((a) => (
              <li
                key={a.id}
                className={`flex items-baseline justify-between gap-3 rounded-xl border border-sabbia bg-carta/60 px-4 py-2.5 ${
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
                  {a.status === 'confirmed' ? (
                    <p className="flex gap-2 text-xs">
                      <button
                        onClick={() => cambiaStato(a.id, 'completed')}
                        className="text-inchiostro/70 hover:text-inchiostro hover:underline"
                      >
                        ✓ Fatta
                      </button>
                      <button
                        onClick={() => cambiaStato(a.id, 'no_show')}
                        className="text-inchiostro/70 hover:text-inchiostro hover:underline"
                      >
                        No-show
                      </button>
                      <button
                        onClick={() => cambiaStato(a.id, 'cancelled')}
                        className="text-terracotta hover:underline"
                      >
                        Annulla
                      </button>
                    </p>
                  ) : (
                    <p className="text-xs text-inchiostro/50">{STATO[a.status] ?? a.status}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confermaAzione && (
        <ConfermaAzione
          titolo={confermaAzione.stato === 'cancelled' ? 'Annullare la prenotazione?' : 'Segnare il no-show?'}
          messaggio={
            confermaAzione.stato === 'cancelled'
              ? 'Il cliente verrà avvisato e potrai proporgli un orario alternativo dall\'agenda.'
              : 'Il cliente risulterà non presentato per questo appuntamento.'
          }
          testoConferma={confermaAzione.stato === 'cancelled' ? 'Sì, annulla' : 'Sì, segna no-show'}
          onAnnulla={() => setConfermaAzione(null)}
          onConferma={() => {
            eseguiCambiaStato(confermaAzione.bookingId, confermaAzione.stato);
            setConfermaAzione(null);
          }}
        />
      )}
    </main>
  );
}

function Stat({ etichetta, valore, accento }: { etichetta: string; valore: string; accento?: boolean }) {
  return (
    <div className="rounded-xl border border-sabbia bg-carta/60 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-inchiostro/50">{etichetta}</p>
      <p className={`mt-0.5 truncate font-medium ${accento ? 'text-terracotta' : ''}`} title={valore}>
        {valore}
      </p>
    </div>
  );
}
