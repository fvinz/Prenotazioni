'use client';

// Prenotazione manuale dall'agenda (per chi telefona o passa in negozio).
// Cliente esistente (ricerca) o nuovo; l'orario è libero: la disponibilità
// pubblicata non vincola il salone, ma il vincolo di esclusione del DB
// impedisce comunque le sovrapposizioni.

import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { normalizzaTelefonoE164 } from '@/lib/phone';
import { CAMPO, type Salone } from './comuni';

interface Operatore {
  id: string;
  name: string;
}

interface Servizio {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_minutes: number;
  price_cents: number;
  deposit_cents: number;
}

interface ClienteTrovato {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string;
}

export function NuovaPrenotazione(props: {
  salone: Salone;
  operatori: Operatore[];
  dataIniziale: string;
  onChiudi: () => void;
  onCreata: () => void;
}) {
  const supabase = getSupabaseBrowserClient();

  const [servizi, setServizi] = useState<Servizio[]>([]);
  const [coppie, setCoppie] = useState<{ operator_id: string; service_id: string }[]>([]);

  const [query, setQuery] = useState('');
  const [trovati, setTrovati] = useState<ClienteTrovato[]>([]);
  const [cliente, setCliente] = useState<ClienteTrovato | null>(null);
  const [nuovo, setNuovo] = useState(false);

  const [servizioId, setServizioId] = useState('');
  const [operatoreId, setOperatoreId] = useState('');
  const [data, setData] = useState(props.dataIniziale);
  const [ora, setOra] = useState('');

  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // Servizi attivi e associazioni operatore-servizio del salone.
  useEffect(() => {
    (async () => {
      const [serviziRes, coppieRes] = await Promise.all([
        supabase
          .from('services')
          .select('id, name, duration_minutes, buffer_minutes, price_cents, deposit_cents')
          .eq('tenant_id', props.salone.id)
          .eq('active', true)
          .order('name'),
        supabase.from('operator_services').select('operator_id, service_id'),
      ]);
      setServizi((serviziRes.data ?? []) as Servizio[]);
      setCoppie(coppieRes.data ?? []);
    })();
  }, [supabase, props.salone.id]);

  // Ricerca clienti con piccolo debounce.
  useEffect(() => {
    if (cliente || nuovo) return;
    const q = query.trim().replace(/[%,]/g, '');
    if (q.length < 2) {
      setTrovati([]);
      return;
    }
    const timer = setTimeout(async () => {
      const { data: rows } = await supabase
        .from('customers')
        .select('id, first_name, last_name, phone')
        .eq('tenant_id', props.salone.id)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(6);
      setTrovati((rows ?? []) as ClienteTrovato[]);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, cliente, nuovo, supabase, props.salone.id]);

  const servizio = servizi.find((s) => s.id === servizioId);
  const operatoriDelServizio = servizioId
    ? props.operatori.filter((o) =>
        coppie.some((c) => c.service_id === servizioId && c.operator_id === o.id),
      )
    : props.operatori;

  async function salva(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!servizio || !operatoreId || !data || !ora) return;
    setInvio(true);
    setErrore(null);
    try {
      // 1) Cliente: esistente oppure upsert (dedup per telefono E.164).
      let customerId = cliente?.id;
      if (!customerId) {
        const form = new FormData(e.currentTarget);
        const telefono = normalizzaTelefonoE164(String(form.get('telefono') ?? ''));
        if (!telefono) {
          setErrore('Il numero di telefono non sembra valido');
          setInvio(false);
          return;
        }
        const { data: riga, error } = await supabase
          .from('customers')
          .upsert(
            {
              tenant_id: props.salone.id,
              first_name: String(form.get('nome')).trim(),
              last_name: String(form.get('cognome')).trim() || null,
              phone: telefono,
            },
            { onConflict: 'tenant_id,phone' },
          )
          .select('id')
          .single();
        if (error || !riga) throw error;
        customerId = riga.id;
      }

      // 2) Prenotazione: ends_at include il buffer, come ovunque.
      const inizio = DateTime.fromISO(`${data}T${ora}`, { zone: props.salone.timezone });
      const fine = inizio.plus({ minutes: servizio.duration_minutes + servizio.buffer_minutes });
      const { error: errIns } = await supabase.from('bookings').insert({
        tenant_id: props.salone.id,
        operator_id: operatoreId,
        service_id: servizio.id,
        customer_id: customerId,
        starts_at: inizio.toUTC().toISO(),
        ends_at: fine.toUTC().toISO(),
        price_cents: servizio.price_cents,
        deposit_cents: servizio.deposit_cents,
        source: 'manual',
      });
      if (errIns) {
        setErrore(
          errIns.code === '23P01'
            ? "L'orario si sovrappone a un'altra prenotazione dell'operatore."
            : 'Non sono riuscito a salvare. Riprova.',
        );
        setInvio(false);
        return;
      }
      props.onCreata();
    } catch {
      setErrore('Non sono riuscito a salvare. Riprova.');
      setInvio(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex items-end justify-center bg-inchiostro/40 p-0 sm:items-center sm:p-6"
      onClick={props.onChiudi}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-crema p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Nuova prenotazione</h2>
          <button onClick={props.onChiudi} className="text-sm text-terracotta hover:underline">
            Chiudi
          </button>
        </div>

        <form onSubmit={salva} className="space-y-3">
          {/* Cliente */}
          {cliente ? (
            <div className="flex items-center justify-between rounded-xl bg-sabbia px-4 py-2">
              <span className="truncate">
                {cliente.first_name} {cliente.last_name ?? ''}{' '}
                <span className="font-mono text-xs text-inchiostro/60">{cliente.phone}</span>
              </span>
              <button
                type="button"
                onClick={() => setCliente(null)}
                className="ml-2 shrink-0 text-sm text-terracotta hover:underline"
              >
                cambia
              </button>
            </div>
          ) : nuovo ? (
            <div className="space-y-3 rounded-xl border border-sabbia p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Nuovo cliente</p>
                <button
                  type="button"
                  onClick={() => setNuovo(false)}
                  className="text-sm text-terracotta hover:underline"
                >
                  cerca esistente
                </button>
              </div>
              <div className="flex gap-2">
                <input name="nome" required placeholder="Nome" className={CAMPO} />
                <input name="cognome" placeholder="Cognome" className={CAMPO} />
              </div>
              <input name="telefono" required type="tel" placeholder="Cellulare" className={CAMPO} />
            </div>
          ) : (
            <div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca cliente (nome o telefono)…"
                className={CAMPO}
              />
              {trovati.length > 0 && (
                <ul className="mt-1 overflow-hidden rounded-xl border border-sabbia bg-carta/80">
                  {trovati.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setCliente(c)}
                        className="flex w-full items-baseline justify-between px-4 py-2 text-left hover:bg-sabbia"
                      >
                        <span>
                          {c.first_name} {c.last_name ?? ''}
                        </span>
                        <span className="font-mono text-xs text-inchiostro/60">{c.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setNuovo(true)}
                className="mt-1 text-sm text-terracotta hover:underline"
              >
                + Nuovo cliente
              </button>
            </div>
          )}

          {/* Servizio e operatore */}
          <select
            required
            value={servizioId}
            onChange={(e) => {
              setServizioId(e.target.value);
              setOperatoreId('');
            }}
            className={CAMPO}
          >
            <option value="">Servizio…</option>
            {servizi.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_minutes} min
              </option>
            ))}
          </select>
          <select
            required
            value={operatoreId}
            onChange={(e) => setOperatoreId(e.target.value)}
            className={CAMPO}
          >
            <option value="">Operatore…</option>
            {operatoriDelServizio.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          {/* Quando */}
          <div className="flex gap-2">
            <input
              type="date"
              required
              value={data}
              onChange={(e) => setData(e.target.value)}
              className={CAMPO}
            />
            <input
              type="time"
              required
              value={ora}
              onChange={(e) => setOra(e.target.value)}
              className={CAMPO}
            />
          </div>
          {servizio && (
            <p className="text-xs text-inchiostro/50">
              Occupa {servizio.duration_minutes + servizio.buffer_minutes} minuti
              {servizio.buffer_minutes > 0 && ` (${servizio.duration_minutes} + ${servizio.buffer_minutes} di buffer)`}
              . L&apos;orario è libero: le sovrapposizioni sono comunque bloccate.
            </p>
          )}

          {errore && <p className="text-sm text-terracotta">{errore}</p>}
          <button
            type="submit"
            disabled={invio || (!cliente && !nuovo)}
            className="w-full rounded-xl bg-terracotta py-3 font-semibold text-crema transition hover:opacity-90 disabled:opacity-60"
          >
            {invio ? 'Un attimo…' : 'Salva prenotazione'}
          </button>
        </form>
      </div>
    </div>
  );
}
