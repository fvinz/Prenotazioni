'use client';

// Widget di prenotazione (client). Flusso in 4 passi:
// servizio -> operatore (saltato se unico) -> giorno+orario -> dati.
// Gli slot arrivano da /api/slots, la conferma passa da /api/bookings.
// La voce del brand: frasi brevi, dirette, zero gergo tecnico.

import { useEffect, useReducer, useState } from 'react';
import type { FreeSlot } from '@/lib/slots';
import {
  giorniPrenotabili,
  raggruppaSlotPerFascia,
  type GiornoPrenotabile,
} from '@/lib/widget-utils';

export interface DatiSalone {
  tenant: { name: string; slug: string; horizonDays: number };
  servizi: { id: string; name: string; duration_minutes: number; price_cents: number }[];
  operatori: { id: string; name: string }[];
  operatoreServizi: { operator_id: string; service_id: string }[];
  weekdayPerOperatore: Record<string, number[]>;
}

type Passo = 'servizio' | 'operatore' | 'quando' | 'dati' | 'fatto';

interface Stato {
  passo: Passo;
  servizioId?: string;
  operatoreId?: string;
  giorno?: GiornoPrenotabile;
  slot?: FreeSlot;
}

type Azione =
  | { tipo: 'scegliServizio'; servizioId: string; operatoreUnicoId?: string }
  | { tipo: 'scegliOperatore'; operatoreId: string }
  | { tipo: 'scegliGiorno'; giorno: GiornoPrenotabile }
  | { tipo: 'scegliSlot'; slot: FreeSlot }
  | { tipo: 'confermato' }
  | { tipo: 'indietro' }
  | { tipo: 'slotConteso' };

function riduci(stato: Stato, azione: Azione): Stato {
  switch (azione.tipo) {
    case 'scegliServizio':
      // Un solo operatore per questo servizio: passo saltato.
      return azione.operatoreUnicoId
        ? { passo: 'quando', servizioId: azione.servizioId, operatoreId: azione.operatoreUnicoId }
        : { passo: 'operatore', servizioId: azione.servizioId };
    case 'scegliOperatore':
      return { ...stato, passo: 'quando', operatoreId: azione.operatoreId };
    case 'scegliGiorno':
      // Stesso passo: gli orari compaiono sotto la striscia dei giorni.
      return { ...stato, giorno: azione.giorno, slot: undefined };
    case 'scegliSlot':
      return { ...stato, passo: 'dati', slot: azione.slot };
    case 'confermato':
      return { ...stato, passo: 'fatto' };
    case 'slotConteso':
      return { ...stato, passo: 'quando', slot: undefined };
    case 'indietro':
      switch (stato.passo) {
        case 'operatore':
          return { passo: 'servizio' };
        case 'quando':
          return { passo: 'servizio' };
        case 'dati':
          return { ...stato, passo: 'quando', slot: undefined };
        default:
          return stato;
      }
  }
}

const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

export function WidgetPrenotazione({ dati }: { dati: DatiSalone }) {
  const [stato, dispatch] = useReducer(riduci, { passo: 'servizio' });

  const servizio = dati.servizi.find((s) => s.id === stato.servizioId);
  const operatore = dati.operatori.find((o) => o.id === stato.operatoreId);

  const operatoriPerServizio = (servizioId: string) =>
    dati.operatori.filter((o) =>
      dati.operatoreServizi.some(
        (os) => os.service_id === servizioId && os.operator_id === o.id,
      ),
    );

  if (dati.servizi.length === 0) {
    return (
      <p className="rounded-xl bg-sabbia p-4 text-center">
        Questo salone non ha ancora servizi prenotabili online.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {stato.passo !== 'servizio' && stato.passo !== 'fatto' && (
        <Riepilogo
          servizio={servizio?.name}
          operatore={operatore?.name}
          giorno={stato.passo === 'dati' ? stato.giorno?.etichetta : undefined}
          orario={stato.slot?.label}
          onIndietro={() => dispatch({ tipo: 'indietro' })}
        />
      )}

      {stato.passo === 'servizio' && (
        <Sezione titolo="Che cosa vuoi fare?">
          {dati.servizi.map((s) => {
            const ops = operatoriPerServizio(s.id);
            return (
              <button
                key={s.id}
                disabled={ops.length === 0}
                onClick={() =>
                  dispatch({
                    tipo: 'scegliServizio',
                    servizioId: s.id,
                    operatoreUnicoId: ops.length === 1 ? ops[0].id : undefined,
                  })
                }
                className="flex w-full items-baseline justify-between rounded-xl border border-sabbia bg-white/60 px-4 py-3 text-left transition hover:border-terracotta disabled:opacity-40"
              >
                <span className="font-medium">{s.name}</span>
                <span className="font-mono text-sm text-inchiostro/60">
                  {s.duration_minutes} min · {euro(s.price_cents)}
                </span>
              </button>
            );
          })}
        </Sezione>
      )}

      {stato.passo === 'operatore' && stato.servizioId && (
        <Sezione titolo="Con chi?">
          {operatoriPerServizio(stato.servizioId).map((o) => (
            <button
              key={o.id}
              onClick={() => dispatch({ tipo: 'scegliOperatore', operatoreId: o.id })}
              className="w-full rounded-xl border border-sabbia bg-white/60 px-4 py-3 text-left font-medium transition hover:border-terracotta"
            >
              {o.name}
            </button>
          ))}
        </Sezione>
      )}

      {stato.passo === 'quando' && stato.servizioId && stato.operatoreId && (
        <Sezione titolo="Quando?">
          <StrisciaGiorni
            horizonDays={dati.tenant.horizonDays}
            weekdayDisponibili={dati.weekdayPerOperatore[stato.operatoreId] ?? []}
            selezionato={stato.giorno?.data}
            onScegli={(giorno) => dispatch({ tipo: 'scegliGiorno', giorno })}
          />
          {stato.giorno && (
            <SceltaOrario
              tenantSlug={dati.tenant.slug}
              operatorId={stato.operatoreId}
              serviceId={stato.servizioId}
              data={stato.giorno.data}
              onScegli={(slot) => dispatch({ tipo: 'scegliSlot', slot })}
            />
          )}
        </Sezione>
      )}

      {stato.passo === 'dati' && stato.servizioId && stato.operatoreId && stato.slot && (
        <Sezione titolo="I tuoi dati">
          <FormDati
            salone={dati.tenant.name}
            tenantSlug={dati.tenant.slug}
            operatorId={stato.operatoreId}
            serviceId={stato.servizioId}
            slot={stato.slot}
            onConfermato={() => dispatch({ tipo: 'confermato' })}
            onSlotConteso={() => dispatch({ tipo: 'slotConteso' })}
          />
        </Sezione>
      )}

      {stato.passo === 'fatto' && servizio && stato.giorno && stato.slot && (
        <div className="rounded-xl bg-inchiostro p-6 text-center text-crema">
          <p className="font-display text-3xl">
            Fatto<span className="text-terracotta">.</span>
          </p>
          <p className="mt-3">
            {servizio.name} · {stato.giorno.etichetta} alle {stato.slot.label}
            {operatore ? ` con ${operatore.name}` : ''}.
          </p>
          <p className="mt-1 text-sm text-crema/60">Ti aspettiamo.</p>
        </div>
      )}
    </div>
  );
}

function Sezione({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl">{titolo}</h2>
      {children}
    </section>
  );
}

function Riepilogo(props: {
  servizio?: string;
  operatore?: string;
  giorno?: string;
  orario?: string;
  onIndietro: () => void;
}) {
  const parti = [props.servizio, props.operatore, props.giorno, props.orario].filter(Boolean);
  return (
    <div className="flex items-center justify-between rounded-xl bg-sabbia px-4 py-2 text-sm">
      <span className="truncate">{parti.join(' · ')}</span>
      <button
        onClick={props.onIndietro}
        className="ml-3 shrink-0 font-medium text-terracotta hover:underline"
      >
        ← indietro
      </button>
    </div>
  );
}

function StrisciaGiorni(props: {
  horizonDays: number;
  weekdayDisponibili: number[];
  selezionato?: string;
  onScegli: (g: GiornoPrenotabile) => void;
}) {
  // 'now' è calcolato al mount, lato client: il fuso locale del telefono
  // del cliente coincide col fuso del salone nei casi d'uso reali; la
  // validità finale la garantiscono comunque /api/slots e il DB.
  const [giorni] = useState(() =>
    giorniPrenotabili({
      now: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      horizonDays: props.horizonDays,
      weekdayDisponibili: props.weekdayDisponibili,
    }),
  );
  if (props.weekdayDisponibili.length === 0) {
    return <p className="text-sm text-inchiostro/60">Nessun orario disponibile online per ora.</p>;
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {giorni.map((g) => (
        <button
          key={g.data}
          disabled={!g.disponibile}
          onClick={() => props.onScegli(g)}
          className={`shrink-0 rounded-xl border px-3 py-2 text-sm capitalize transition disabled:opacity-30 ${
            props.selezionato === g.data
              ? 'border-terracotta bg-terracotta font-medium text-crema'
              : 'border-sabbia bg-white/60 hover:border-terracotta'
          }`}
        >
          {g.etichetta}
        </button>
      ))}
    </div>
  );
}

function SceltaOrario(props: {
  tenantSlug: string;
  operatorId: string;
  serviceId: string;
  data: string;
  onScegli: (slot: FreeSlot) => void;
}) {
  const [slots, setSlots] = useState<FreeSlot[] | null>(null);
  const [errore, setErrore] = useState(false);

  useEffect(() => {
    let attivo = true;
    setSlots(null);
    setErrore(false);
    const qs = new URLSearchParams({
      tenantSlug: props.tenantSlug,
      operatorId: props.operatorId,
      serviceId: props.serviceId,
      date: props.data,
    });
    fetch(`/api/slots?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => attivo && setSlots(json.slots))
      .catch(() => attivo && setErrore(true));
    return () => {
      attivo = false;
    };
  }, [props.tenantSlug, props.operatorId, props.serviceId, props.data]);

  if (errore)
    return <p className="text-sm text-terracotta">Qualcosa non ha funzionato. Riprova.</p>;
  if (slots === null) return <p className="text-sm text-inchiostro/60">Un attimo…</p>;
  if (slots.length === 0)
    return (
      <p className="text-sm text-inchiostro/60">
        Niente di libero in questo giorno. Prova con un altro.
      </p>
    );

  const { mattina, pomeriggio } = raggruppaSlotPerFascia(slots);
  const Griglia = ({ titolo, lista }: { titolo: string; lista: FreeSlot[] }) =>
    lista.length === 0 ? null : (
      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-inchiostro/50">{titolo}</p>
        <div className="grid grid-cols-4 gap-2">
          {lista.map((slot) => (
            <button
              key={slot.start}
              onClick={() => props.onScegli(slot)}
              className="rounded-xl border border-sabbia bg-white/60 py-2 font-mono text-sm transition hover:border-terracotta"
            >
              {slot.label}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="mt-3 space-y-3">
      <Griglia titolo="Mattina" lista={mattina} />
      <Griglia titolo="Pomeriggio" lista={pomeriggio} />
    </div>
  );
}

function FormDati(props: {
  salone: string;
  tenantSlug: string;
  operatorId: string;
  serviceId: string;
  slot: FreeSlot;
  onConfermato: () => void;
  onSlotConteso: () => void;
}) {
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function invia(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setInvio(true);
    setErrore(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: props.tenantSlug,
          operatorId: props.operatorId,
          serviceId: props.serviceId,
          startsAt: props.slot.start,
          nome: form.get('nome'),
          telefono: form.get('telefono'),
          email: form.get('email'),
          website: form.get('website'), // honeypot
        }),
      });
      if (res.ok) {
        props.onConfermato();
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Slot appena preso da qualcun altro: torna alla scelta orario.
        props.onSlotConteso();
        return;
      }
      setErrore(json.error ?? 'Qualcosa non ha funzionato. Riprova.');
    } catch {
      setErrore('Qualcosa non ha funzionato. Riprova.');
    } finally {
      setInvio(false);
    }
  }

  const campo =
    'w-full rounded-xl border border-sabbia bg-white/60 px-4 py-3 outline-none transition focus:border-terracotta';

  return (
    <form onSubmit={invia} className="space-y-3">
      <input name="nome" required placeholder="Nome e cognome" className={campo} />
      <input
        name="telefono"
        required
        type="tel"
        placeholder="Cellulare (es. 333 123 4567)"
        className={campo}
      />
      <input name="email" type="email" placeholder="Email (facoltativa)" className={campo} />
      {/* Honeypot: invisibile agli umani, irresistibile per i bot. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      {errore && <p className="text-sm text-terracotta">{errore}</p>}
      <button
        type="submit"
        disabled={invio}
        className="w-full rounded-xl bg-terracotta py-3 font-semibold text-crema transition hover:opacity-90 disabled:opacity-60"
      >
        {invio ? 'Un attimo…' : 'Conferma l’appuntamento'}
      </button>
      <p className="text-xs text-inchiostro/50">
        Inviando, i tuoi dati saranno trattati da {props.salone} solo per gestire
        l’appuntamento.
      </p>
    </form>
  );
}
