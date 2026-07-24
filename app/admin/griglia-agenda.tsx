'use client';

// Agenda a griglia: un operatore per colonna, orari sull'asse verticale.
// Cliccando su un appuntamento si apre il dettaglio con le azioni
// (Fatta/No-show/Annulla, le stesse di sempre); cliccando su uno spazio
// vuoto si apre "Blocca fascia", che crea direttamente una riga in
// time_off — la stessa tabella già usata da Impostazioni → Chiusure, solo
// raggiungibile da qui senza cambiare pagina. Su schermi piccoli si passa
// a un selettore di operatore + una sola colonna alla volta.

import { useState } from 'react';
import Link from 'next/link';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Salone } from './comuni';

export interface Operatore {
  id: string;
  name: string;
}

export interface Prenotazione {
  id: string;
  operator_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  services: { name: string } | null;
  customers: {
    first_name: string;
    last_name: string | null;
    phone: string;
    email: string | null;
  } | null;
}

export interface Chiusura {
  id: string;
  operator_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

const STATO_ETICHETTA: Record<string, string> = {
  cancelled: 'annullata',
  completed: 'completata',
  no_show: 'no-show',
};

const PX_ORA = 80;

// Le classi sono scritte per intero (non composte a runtime): il
// compilatore di Tailwind deve vederle così com'sono nel codice sorgente
// per generarle.
const STILE_OP = [
  { bordo: 'border-l-op-1', avatar: 'bg-op-1' },
  { bordo: 'border-l-op-2', avatar: 'bg-op-2' },
  { bordo: 'border-l-op-3', avatar: 'bg-op-3' },
  { bordo: 'border-l-op-4', avatar: 'bg-op-4' },
];

function iniziali(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface Bozza {
  operatorId: string;
  operatorNome: string;
  inizio: DateTime;
  fine: DateTime;
}

export function GrigliaAgenda(props: {
  salone: Salone;
  giornoISO: string;
  oggi: boolean;
  operatori: Operatore[];
  prenotazioni: Prenotazione[];
  chiusure: Chiusura[];
  onCambiaStato: (p: Prenotazione, stato: 'completed' | 'no_show' | 'cancelled') => void;
  onBloccato: () => void;
}) {
  const supabase = getSupabaseBrowserClient();
  const tz = props.salone.timezone;
  const [dettaglio, setDettaglio] = useState<Prenotazione | null>(null);
  const [bozza, setBozza] = useState<Bozza | null>(null);
  const [operatoreMobile, setOperatoreMobile] = useState<string | null>(null);
  const [invioBlocco, setInvioBlocco] = useState(false);
  const [erroreBlocco, setErroreBlocco] = useState<string | null>(null);

  if (props.operatori.length === 0) {
    return (
      <p className="rounded-xl bg-carta/60 p-6 text-center text-inchiostro/60">
        Aggiungi un operatore da Impostazioni per vedere l&apos;agenda.
      </p>
    );
  }

  // Finestra oraria della griglia: 8–20 di default, allargata se un
  // appuntamento cade fuori (mai tagliato).
  let oraMin = 8;
  let oraMax = 20;
  for (const p of props.prenotazioni) {
    const s = DateTime.fromISO(p.starts_at).setZone(tz);
    const e = DateTime.fromISO(p.ends_at).setZone(tz);
    oraMin = Math.min(oraMin, Math.floor(s.hour + s.minute / 60));
    oraMax = Math.max(oraMax, Math.ceil(e.hour + e.minute / 60));
  }
  const altezzaGriglia = (oraMax - oraMin) * PX_ORA;
  const oreEtichette = Array.from({ length: oraMax - oraMin + 1 }, (_, i) => oraMin + i);
  const inizioGiorno = DateTime.fromISO(props.giornoISO, { zone: tz }).startOf('day');

  function posizionePx(iso: string): number {
    const dt = DateTime.fromISO(iso).setZone(tz);
    const minuti = (dt.hour - oraMin) * 60 + dt.minute;
    return (minuti / 60) * PX_ORA;
  }

  const adessoOffset = (() => {
    if (!props.oggi) return null;
    const adesso = DateTime.now().setZone(tz);
    const minuti = (adesso.hour - oraMin) * 60 + adesso.minute;
    return minuti >= 0 && minuti <= (oraMax - oraMin) * 60 ? (minuti / 60) * PX_ORA : null;
  })();

  function apriSlot(operatorId: string, operatorNome: string, ora: number) {
    const inizio = inizioGiorno.plus({ hours: ora });
    setBozza({ operatorId, operatorNome, inizio, fine: inizio.plus({ hours: 1 }) });
  }

  async function confermaBlocco(inizio: DateTime, fine: DateTime, motivo: string, ripeti: boolean) {
    if (!bozza) return;
    setInvioBlocco(true);
    setErroreBlocco(null);
    const occorrenze = ripeti ? 8 : 1;
    const righe = Array.from({ length: occorrenze }, (_, i) => ({
      tenant_id: props.salone.id,
      operator_id: bozza.operatorId,
      starts_at: inizio.plus({ weeks: i }).toUTC().toISO()!,
      ends_at: fine.plus({ weeks: i }).toUTC().toISO()!,
      reason: motivo.trim() || null,
    }));
    const { error } = await supabase.from('time_off').insert(righe);
    setInvioBlocco(false);
    if (error) {
      setErroreBlocco('Periodo non valido: l’orario di fine deve seguire quello di inizio.');
      return;
    }
    setBozza(null);
    props.onBloccato();
  }

  const operatoreSelezionatoMobile = operatoreMobile ?? props.operatori[0].id;
  const indiceMobile = props.operatori.findIndex((o) => o.id === operatoreSelezionatoMobile);
  const opMobile = props.operatori[indiceMobile];

  return (
    <>
      {/* Desktop: un operatore per colonna. */}
      <div className="hidden overflow-x-auto rounded-xl border border-sabbia md:block">
        <div
          className="relative grid min-w-[720px]"
          style={{
            gridTemplateColumns: `52px repeat(${props.operatori.length}, minmax(160px, 1fr))`,
            gridTemplateRows: `auto ${altezzaGriglia}px`,
          }}
        >
          <div className="sticky top-0 z-10 border-b border-sabbia bg-crema" />
          {props.operatori.map((op, i) => (
            <div
              key={op.id}
              className="sticky top-0 z-10 flex items-center gap-2 border-b border-l border-sabbia bg-crema px-2 py-2.5"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-crema ${STILE_OP[i % STILE_OP.length].avatar}`}
              >
                {iniziali(op.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{op.name}</p>
                <p className="text-xs text-inchiostro/50">
                  {props.prenotazioni.filter((p) => p.operator_id === op.id && p.status !== 'cancelled').length}{' '}
                  app.
                </p>
              </div>
              <Link
                href={`/admin/impostazioni?operatore=${op.id}#orari`}
                title={`Orari e ferie di ${op.name}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sabbia text-[10px] text-inchiostro/50 transition hover:border-terracotta hover:text-terracotta"
              >
                ⚙
              </Link>
            </div>
          ))}

          <div className="relative border-r border-sabbia" style={{ gridRow: 2 }}>
            {oreEtichette.map((ora) => (
              <span
                key={ora}
                className="absolute right-1 -translate-y-1/2 font-mono text-xs text-inchiostro/40"
                style={{ top: (ora - oraMin) * PX_ORA }}
              >
                {ora}:00
              </span>
            ))}
          </div>

          {props.operatori.map((op, i) => (
            <ColonnaOperatore
              key={op.id}
              operatore={op}
              indiceColore={i}
              oraMin={oraMin}
              oraMax={oraMax}
              prenotazioni={props.prenotazioni.filter((p) => p.operator_id === op.id)}
              chiusure={props.chiusure.filter((c) => c.operator_id === op.id || c.operator_id === null)}
              posizionePx={posizionePx}
              onSelezionaPrenotazione={setDettaglio}
              onSelezionaSlot={(ora) => apriSlot(op.id, op.name, ora)}
            />
          ))}

          {adessoOffset !== null && (
            <div
              className="relative"
              style={{ gridRow: 2, gridColumn: '1 / -1', pointerEvents: 'none' }}
            >
              <div className="absolute left-0 right-0 border-t border-terracotta" style={{ top: adessoOffset }}>
                <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-terracotta" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: selettore di operatore + una colonna sola. */}
      <div className="md:hidden">
        <div className="mb-3 flex gap-3 overflow-x-auto pb-1">
          {props.operatori.map((op, i) => (
            <button
              key={op.id}
              onClick={() => setOperatoreMobile(op.id)}
              className={`flex shrink-0 flex-col items-center gap-1 ${
                operatoreSelezionatoMobile === op.id ? 'opacity-100' : 'opacity-45'
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-crema ${STILE_OP[i % STILE_OP.length].avatar} ${
                  operatoreSelezionatoMobile === op.id ? 'ring-2 ring-terracotta ring-offset-2 ring-offset-crema' : ''
                }`}
              >
                {iniziali(op.name)}
              </span>
              <span className="text-[11px]">{op.name}</span>
            </button>
          ))}
        </div>
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-sm font-medium">{opMobile.name}</p>
          <Link
            href={`/admin/impostazioni?operatore=${opMobile.id}#orari`}
            className="text-xs text-inchiostro/50 hover:text-terracotta"
          >
            ⚙ Orari e ferie
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-sabbia">
          <div
            className="relative grid min-w-[300px]"
            style={{ gridTemplateColumns: '44px 1fr', height: altezzaGriglia }}
          >
            <div className="relative border-r border-sabbia">
              {oreEtichette.map((ora) => (
                <span
                  key={ora}
                  className="absolute right-1 -translate-y-1/2 font-mono text-[11px] text-inchiostro/40"
                  style={{ top: (ora - oraMin) * PX_ORA }}
                >
                  {ora}:00
                </span>
              ))}
            </div>
            <ColonnaOperatore
              operatore={opMobile}
              indiceColore={indiceMobile}
              oraMin={oraMin}
              oraMax={oraMax}
              prenotazioni={props.prenotazioni.filter((p) => p.operator_id === opMobile.id)}
              chiusure={props.chiusure.filter(
                (c) => c.operator_id === opMobile.id || c.operator_id === null,
              )}
              posizionePx={posizionePx}
              onSelezionaPrenotazione={setDettaglio}
              onSelezionaSlot={(ora) => apriSlot(opMobile.id, opMobile.name, ora)}
            />
            {adessoOffset !== null && (
              <div
                className="pointer-events-none absolute left-0 right-0 border-t border-terracotta"
                style={{ top: adessoOffset, gridColumn: '1 / -1' }}
              >
                <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-terracotta" />
              </div>
            )}
          </div>
        </div>
      </div>

      {dettaglio && (
        <DettaglioPrenotazione
          prenotazione={dettaglio}
          tz={tz}
          onChiudi={() => setDettaglio(null)}
          onCambiaStato={(stato) => {
            props.onCambiaStato(dettaglio, stato);
            setDettaglio(null);
          }}
        />
      )}

      {bozza && (
        <BloccaFascia
          bozza={bozza}
          invio={invioBlocco}
          errore={erroreBlocco}
          onChiudi={() => setBozza(null)}
          onConferma={confermaBlocco}
        />
      )}
    </>
  );
}

function ColonnaOperatore(props: {
  operatore: Operatore;
  indiceColore: number;
  oraMin: number;
  oraMax: number;
  prenotazioni: Prenotazione[];
  chiusure: Chiusura[];
  posizionePx: (iso: string) => number;
  onSelezionaPrenotazione: (p: Prenotazione) => void;
  onSelezionaSlot: (ora: number) => void;
}) {
  const stile = STILE_OP[props.indiceColore % STILE_OP.length];
  const oreClic: number[] = [];
  for (let o = props.oraMin; o < props.oraMax; o += 0.5) oreClic.push(o);

  return (
    <div className="relative border-l border-sabbia" style={{ gridRow: 2 }}>
      {oreClic.map((ora) => (
        <button
          key={ora}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => props.onSelezionaSlot(ora)}
          className="absolute left-0 right-0 transition hover:bg-terracotta/5"
          style={{ top: (ora - props.oraMin) * PX_ORA, height: PX_ORA / 2 }}
        />
      ))}
      {Array.from({ length: props.oraMax - props.oraMin }, (_, i) => (
        <div
          key={i}
          className="pointer-events-none absolute left-0 right-0 border-t border-sabbia/60"
          style={{ top: i * PX_ORA }}
        />
      ))}
      {props.chiusure.map((c) => {
        const top = props.posizionePx(c.starts_at);
        const bottom = props.posizionePx(c.ends_at);
        return (
          <div
            key={c.id}
            className="pointer-events-none absolute left-1 right-1 flex items-center justify-center rounded-lg bg-sabbia/70 px-1 text-center font-mono text-[10px] uppercase tracking-wide text-inchiostro/50"
            style={{ top, height: Math.max(bottom - top, 20) }}
          >
            {c.reason ?? 'Chiuso'}
          </div>
        );
      })}
      {props.prenotazioni.map((p) => {
        const top = props.posizionePx(p.starts_at);
        const bottom = props.posizionePx(p.ends_at);
        const nome = p.customers
          ? `${p.customers.first_name} ${p.customers.last_name ?? ''}`.trim()
          : 'Cliente';
        const annullata = p.status === 'cancelled';
        const completata = p.status === 'completed';
        return (
          <button
            key={p.id}
            onClick={() => props.onSelezionaPrenotazione(p)}
            className={`absolute left-1 right-1 overflow-hidden rounded-lg border-l-[3px] bg-carta px-2 py-1 text-left shadow-sm transition hover:shadow-md ${stile.bordo} ${
              annullata ? 'opacity-45' : ''
            }`}
            style={{ top, height: Math.max(bottom - top, 24) }}
          >
            {completata && (
              <span className="absolute right-1 top-1 text-[10px] font-bold text-buono">✓</span>
            )}
            <span className="block truncate text-[11px] font-semibold">{nome}</span>
            <span
              className={`block truncate text-[10px] text-inchiostro/60 ${annullata ? 'line-through' : ''}`}
            >
              {p.services?.name ?? 'Servizio'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DettaglioPrenotazione(props: {
  prenotazione: Prenotazione;
  tz: string;
  onChiudi: () => void;
  onCambiaStato: (stato: 'completed' | 'no_show' | 'cancelled') => void;
}) {
  const p = props.prenotazione;
  const inizio = DateTime.fromISO(p.starts_at).setZone(props.tz).setLocale('it');
  const fine = DateTime.fromISO(p.ends_at).setZone(props.tz).setLocale('it');
  const nome = p.customers
    ? `${p.customers.first_name} ${p.customers.last_name ?? ''}`.trim()
    : 'Cliente';

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-inchiostro/40 p-0 sm:items-center sm:p-6"
      onClick={props.onChiudi}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-crema p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="truncate font-display text-xl">{nome}</h2>
          <button onClick={props.onChiudi} className="shrink-0 text-sm text-terracotta hover:underline">
            Chiudi
          </button>
        </div>
        <p className="text-sm text-inchiostro/70">{p.services?.name ?? 'Servizio'}</p>
        <p className="mt-1 font-mono text-sm text-inchiostro/50">
          {inizio.toFormat('cccc d LLLL')} · {inizio.toFormat('HH:mm')}–{fine.toFormat('HH:mm')}
        </p>
        {p.customers?.phone && (
          <p className="mt-1 font-mono text-sm text-inchiostro/50">{p.customers.phone}</p>
        )}

        {p.status !== 'confirmed' ? (
          <p className="mt-3 rounded-lg bg-sabbia px-3 py-1.5 text-sm">
            Stato: {STATO_ETICHETTA[p.status] ?? p.status}
          </p>
        ) : (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => props.onCambiaStato('completed')}
              className="flex-1 rounded-xl bg-terracotta py-2 text-sm font-semibold text-crema transition hover:opacity-90"
            >
              ✓ Fatta
            </button>
            <button
              onClick={() => props.onCambiaStato('no_show')}
              className="flex-1 rounded-xl border border-sabbia py-2 text-sm font-medium transition hover:bg-sabbia"
            >
              No-show
            </button>
            <button
              onClick={() => props.onCambiaStato('cancelled')}
              className="flex-1 rounded-xl border border-terracotta py-2 text-sm font-medium text-terracotta transition hover:bg-terracotta/10"
            >
              Annulla
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BloccaFascia(props: {
  bozza: Bozza;
  invio: boolean;
  errore: string | null;
  onChiudi: () => void;
  onConferma: (inizio: DateTime, fine: DateTime, motivo: string, ripeti: boolean) => void;
}) {
  const [dalle, setDalle] = useState(props.bozza.inizio.toFormat('HH:mm'));
  const [alle, setAlle] = useState(props.bozza.fine.toFormat('HH:mm'));
  const [motivo, setMotivo] = useState('');
  const [ripeti, setRipeti] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const [hDalle, mDalle] = dalle.split(':').map(Number);
    const [hAlle, mAlle] = alle.split(':').map(Number);
    const inizio = props.bozza.inizio.set({ hour: hDalle, minute: mDalle });
    const fine = props.bozza.inizio.set({ hour: hAlle, minute: mAlle });
    props.onConferma(inizio, fine, motivo, ripeti);
  }

  const giornoEtichetta = props.bozza.inizio.setLocale('it').toFormat('cccc d LLLL');
  const giornoSettimana = props.bozza.inizio.setLocale('it').toFormat('cccc');

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-inchiostro/40 p-0 sm:items-center sm:p-6"
      onClick={props.onChiudi}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-t-2xl bg-crema p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Blocca fascia</h2>
          <button
            type="button"
            onClick={props.onChiudi}
            className="text-sm text-terracotta hover:underline"
          >
            Chiudi
          </button>
        </div>
        <p className="mb-3 text-sm text-inchiostro/60">
          {props.bozza.operatorNome} · <span className="capitalize">{giornoEtichetta}</span>
        </p>
        <div className="flex gap-2">
          <label className="flex-1 text-sm">
            Dalle
            <input
              type="time"
              required
              value={dalle}
              onChange={(e) => setDalle(e.target.value)}
              className="mt-0.5 w-full rounded-xl border border-sabbia bg-carta/60 px-3 py-2 outline-none transition focus:border-terracotta"
            />
          </label>
          <label className="flex-1 text-sm">
            Alle
            <input
              type="time"
              required
              value={alle}
              onChange={(e) => setAlle(e.target.value)}
              className="mt-0.5 w-full rounded-xl border border-sabbia bg-carta/60 px-3 py-2 outline-none transition focus:border-terracotta"
            />
          </label>
        </div>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo (facoltativo): ferie, formazione…"
          className="mt-2 w-full rounded-xl border border-sabbia bg-carta/60 px-3 py-2 text-sm outline-none transition focus:border-terracotta"
        />
        <label className="mt-2 flex items-center gap-2 text-sm text-inchiostro/70">
          <input type="checkbox" checked={ripeti} onChange={(e) => setRipeti(e.target.checked)} />
          Ripeti ogni {giornoSettimana} per le prossime 8 settimane
        </label>
        {props.errore && <p className="mt-2 text-sm text-terracotta">{props.errore}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={props.onChiudi}
            className="flex-1 rounded-xl border border-sabbia py-2 text-sm font-medium transition hover:bg-sabbia"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={props.invio}
            className="flex-1 rounded-xl bg-terracotta py-2 text-sm font-semibold text-crema transition hover:opacity-90 disabled:opacity-60"
          >
            {props.invio ? 'Un attimo…' : 'Blocca fascia'}
          </button>
        </div>
      </form>
    </div>
  );
}
