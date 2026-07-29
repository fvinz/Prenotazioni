'use client';

// Widget di prenotazione (client). Flusso in 4 passi:
// servizio -> operatore (saltato se unico) -> giorno+orario -> dati.
// Gli slot arrivano da /api/slots, la conferma passa da /api/bookings.
// La voce del brand: frasi brevi, dirette, zero gergo tecnico.

import { useEffect, useReducer, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DateTime } from 'luxon';
import type { FreeSlot } from '@/lib/slots';
import {
  giorniPrenotabili,
  raggruppaSlotPerFascia,
  weekdayAggregati,
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
  /** undefined = non ancora scelto; null = "chiunque sia libero"; string = un operatore preciso. */
  operatoreId?: string | null;
  giorno?: GiornoPrenotabile;
  slot?: FreeSlot;
  managementToken?: string;
  nomeCliente?: string;
}

type Azione =
  | { tipo: 'scegliServizio'; servizioId: string; operatoreUnicoId?: string }
  | { tipo: 'scegliOperatore'; operatoreId: string | null }
  | { tipo: 'scegliGiorno'; giorno: GiornoPrenotabile }
  | { tipo: 'scegliSlot'; slot: FreeSlot }
  | {
      tipo: 'confermato';
      managementToken?: string;
      nomeCliente?: string;
      /** L'operatore davvero assegnato, se il cliente aveva scelto "chiunque sia libero". */
      operatoreAssegnatoId?: string;
    }
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
      return {
        ...stato,
        passo: 'fatto',
        managementToken: azione.managementToken,
        nomeCliente: azione.nomeCliente,
        // Se era stato scelto "chiunque sia libero", da qui in poi si
        // ragiona sull'operatore davvero assegnato dal server.
        operatoreId: azione.operatoreAssegnatoId ?? stato.operatoreId,
      };
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

// Collegamento pre-compilato (es. dopo un annullamento, per proporre nuovi
// orari): ?servizio=<id>&operatore=<id>&giorno=YYYY-MM-DD&suggeriti=iso,iso.
// Se servizio/operatore non sono coerenti con i dati del salone, si ignora
// e si parte dal primo passo come sempre.
function statoDaIndirizzo(dati: DatiSalone, parametri: URLSearchParams): Stato {
  const servizioId = parametri.get('servizio');
  const operatoreId = parametri.get('operatore');
  if (!servizioId || !operatoreId) return { passo: 'servizio' };
  const servizioValido = dati.servizi.some((s) => s.id === servizioId);
  const coppiaValida = dati.operatoreServizi.some(
    (os) => os.service_id === servizioId && os.operator_id === operatoreId,
  );
  if (!servizioValido || !coppiaValida) return { passo: 'servizio' };
  return { passo: 'quando', servizioId, operatoreId };
}

interface DatiPrecompilati {
  nome: string;
  cognome: string;
  prefisso: string;
  telefono: string;
  email: string;
}

// Divide un numero in E.164 (es. "+393331234567", già a sistema) nel
// prefisso e nella parte locale che il form usa in due campi separati.
function scindiTelefono(e164: string): { prefisso: string; locale: string } {
  const corrispondenza = [...PREFISSI]
    .sort((a, b) => b.code.length - a.code.length)
    .find((p) => e164.startsWith(p.code));
  if (!corrispondenza) return { prefisso: '+39', locale: e164 };
  return { prefisso: corrispondenza.code, locale: e164.slice(corrispondenza.code.length).trim() };
}

// Dopo un annullamento del salone, il link di riproposta include anche
// i dati del cliente già a sistema (sezione 3 del brief: nessuna
// frizione in più per un semplice cambio orario). Restano campi normali
// del form, che il cliente può comunque correggere.
function precompilatoDaIndirizzo(parametri: URLSearchParams): DatiPrecompilati | undefined {
  const nome = parametri.get('nome');
  const telefono = parametri.get('telefono');
  if (!nome || !telefono) return undefined;
  const { prefisso, locale } = scindiTelefono(telefono);
  return {
    nome,
    cognome: parametri.get('cognome') ?? '',
    prefisso,
    telefono: locale,
    email: parametri.get('email') ?? '',
  };
}

export function WidgetPrenotazione({ dati }: { dati: DatiSalone }) {
  const parametri = useSearchParams();
  const [stato, dispatch] = useReducer(riduci, undefined, () => statoDaIndirizzo(dati, parametri));
  const [suggeriti] = useState(() => new Set(parametri.get('suggeriti')?.split(',').filter(Boolean) ?? []));
  const [precompilato] = useState(() => precompilatoDaIndirizzo(parametri));

  // Se l'indirizzo indica anche un giorno, lo selezioniamo subito: il
  // cliente vede già gli orari suggeriti, invece di dover ricliccare la
  // striscia dei giorni. Fatto in un effetto (non nell'inizializzazione
  // dello stato) perché il "giorno" della UI incorpora un'etichetta e un
  // controllo di validità che vale la pena calcolare una sola volta.
  useEffect(() => {
    const giornoParam = parametri.get('giorno');
    if (!giornoParam) return;
    const g = DateTime.fromISO(giornoParam, { zone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (!g.isValid) return;
    dispatch({
      tipo: 'scegliGiorno',
      giorno: {
        data: giornoParam,
        weekday: g.weekday % 7,
        etichetta: g.setLocale('it').toFormat('ccc d LLLL'),
        disponibile: true,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          operatore={stato.operatoreId === null ? 'Chiunque sia libero' : operatore?.name}
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
                className="flex w-full items-baseline justify-between rounded-xl border border-sabbia bg-carta/60 px-4 py-3 text-left transition hover:border-terracotta disabled:opacity-40"
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
          <button
            onClick={() => dispatch({ tipo: 'scegliOperatore', operatoreId: null })}
            className="w-full rounded-xl border border-dashed border-sabbia bg-carta/60 px-4 py-3 text-left transition hover:border-terracotta"
          >
            <span className="font-medium">Chiunque sia libero</span>
            <span className="block text-xs font-normal text-inchiostro/50">
              Vedi tutti gli orari disponibili
            </span>
          </button>
          {operatoriPerServizio(stato.servizioId).map((o) => (
            <button
              key={o.id}
              onClick={() => dispatch({ tipo: 'scegliOperatore', operatoreId: o.id })}
              className="w-full rounded-xl border border-sabbia bg-carta/60 px-4 py-3 text-left font-medium transition hover:border-terracotta"
            >
              {o.name}
            </button>
          ))}
        </Sezione>
      )}

      {stato.passo === 'quando' && stato.servizioId && stato.operatoreId !== undefined && (
        <Sezione titolo="Quando?">
          <StrisciaGiorni
            horizonDays={dati.tenant.horizonDays}
            weekdayDisponibili={
              stato.operatoreId === null
                ? weekdayAggregati(
                    dati.weekdayPerOperatore,
                    operatoriPerServizio(stato.servizioId).map((o) => o.id),
                  )
                : (dati.weekdayPerOperatore[stato.operatoreId] ?? [])
            }
            selezionato={stato.giorno?.data}
            onScegli={(giorno) => dispatch({ tipo: 'scegliGiorno', giorno })}
          />
          {stato.giorno && (
            <SceltaOrario
              tenantSlug={dati.tenant.slug}
              operatorId={stato.operatoreId}
              serviceId={stato.servizioId}
              data={stato.giorno.data}
              suggeriti={suggeriti}
              onScegli={(slot) => dispatch({ tipo: 'scegliSlot', slot })}
            />
          )}
        </Sezione>
      )}

      {stato.passo === 'dati' && stato.servizioId && stato.operatoreId !== undefined && stato.slot && (
        <Sezione titolo="I tuoi dati">
          <FormDati
            salone={dati.tenant.name}
            tenantSlug={dati.tenant.slug}
            operatorId={stato.operatoreId}
            serviceId={stato.servizioId}
            slot={stato.slot}
            precompilato={precompilato}
            onConfermato={(managementToken, nomeCliente, operatoreAssegnatoId) =>
              dispatch({ tipo: 'confermato', managementToken, nomeCliente, operatoreAssegnatoId })
            }
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
          <p className="mt-1 text-sm text-crema/60">
            Ti aspettiamo{stato.nomeCliente ? `, ${stato.nomeCliente}` : ''}.
          </p>
          <AggiungiAlCalendario
            titolo={`${servizio.name} · ${dati.tenant.name}`}
            descrizione={
              `Appuntamento per ${servizio.name}` +
              (operatore ? ` con ${operatore.name}` : '') +
              ` da ${dati.tenant.name}.` +
              (stato.managementToken
                ? ` Gestisci la prenotazione: ${typeof window !== 'undefined' ? window.location.origin : ''}/prenotazione/${stato.managementToken}`
                : '')
            }
            inizio={stato.slot.start}
            durataMinuti={servizio.duration_minutes}
          />
          {stato.managementToken && <LinkGestione token={stato.managementToken} />}
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

// Esportati: riusati anche in /prenotazione/[token] per il cambio orario.
export function StrisciaGiorni(props: {
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
    <div className="scroll-nascosta flex gap-2 overflow-x-auto pb-2">
      {giorni.map((g) => (
        <button
          key={g.data}
          disabled={!g.disponibile}
          onClick={() => props.onScegli(g)}
          className={`shrink-0 rounded-xl border px-3 py-2 text-sm capitalize transition disabled:opacity-30 ${
            props.selezionato === g.data
              ? 'border-terracotta bg-terracotta font-medium text-crema'
              : 'border-sabbia bg-carta/60 hover:border-terracotta'
          }`}
        >
          {g.etichetta}
        </button>
      ))}
    </div>
  );
}

export function SceltaOrario(props: {
  tenantSlug: string;
  /** null = "chiunque sia libero": /api/slots aggrega tutti gli operatori idonei. */
  operatorId: string | null;
  serviceId: string;
  data: string;
  /** Orari (ISO) che il salone ha proposto: evidenziati nella griglia. */
  suggeriti?: Set<string>;
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
      serviceId: props.serviceId,
      date: props.data,
    });
    if (props.operatorId) qs.set('operatorId', props.operatorId);
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
          {lista.map((slot) => {
            const consigliato = props.suggeriti?.has(slot.start);
            return (
              <button
                key={slot.start}
                onClick={() => props.onScegli(slot)}
                className={`relative rounded-xl border py-2 font-mono text-sm transition ${
                  consigliato
                    ? 'border-terracotta bg-terracotta/10 font-medium'
                    : 'border-sabbia bg-carta/60 hover:border-terracotta'
                }`}
              >
                {consigliato && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-terracotta px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-crema">
                    Consigliato
                  </span>
                )}
                {slot.label}
              </button>
            );
          })}
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

// Prefissi internazionali proposti nel form (l'Italia è il default).
const PREFISSI = [
  { code: '+39', label: '🇮🇹 +39' },
  { code: '+41', label: '🇨🇭 +41' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+34', label: '🇪🇸 +34' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+43', label: '🇦🇹 +43' },
  { code: '+32', label: '🇧🇪 +32' },
  { code: '+31', label: '🇳🇱 +31' },
  { code: '+351', label: '🇵🇹 +351' },
  { code: '+40', label: '🇷🇴 +40' },
  { code: '+355', label: '🇦🇱 +355' },
  { code: '+380', label: '🇺🇦 +380' },
  { code: '+48', label: '🇵🇱 +48' },
  { code: '+212', label: '🇲🇦 +212' },
  { code: '+86', label: '🇨🇳 +86' },
  { code: '+63', label: '🇵🇭 +63' },
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+1', label: '🇺🇸 +1' },
];

function FormDati(props: {
  salone: string;
  tenantSlug: string;
  /** null = "chiunque sia libero": lo decide create_booking. */
  operatorId: string | null;
  serviceId: string;
  slot: FreeSlot;
  precompilato?: DatiPrecompilati;
  onConfermato: (managementToken?: string, nomeCliente?: string, operatoreAssegnatoId?: string) => void;
  onSlotConteso: () => void;
}) {
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function invia(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const nome = String(form.get('nome') ?? '').trim();
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
          cognome: form.get('cognome'),
          prefisso: form.get('prefisso'),
          telefono: form.get('telefono'),
          email: form.get('email'),
          website: form.get('website'), // honeypot
        }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        props.onConfermato(json.managementToken, nome || undefined, json.operatorId || undefined);
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
    'w-full rounded-xl border border-sabbia bg-carta/60 px-4 py-3 outline-none transition focus:border-terracotta';

  return (
    <form onSubmit={invia} className="space-y-3">
      <div className="flex gap-3">
        <input
          name="nome"
          required
          placeholder="Nome"
          defaultValue={props.precompilato?.nome}
          className={campo}
        />
        <input
          name="cognome"
          required
          placeholder="Cognome"
          defaultValue={props.precompilato?.cognome}
          className={campo}
        />
      </div>
      <div className="flex gap-3">
        <select
          name="prefisso"
          defaultValue={props.precompilato?.prefisso ?? '+39'}
          aria-label="Prefisso internazionale"
          className="shrink-0 rounded-xl border border-sabbia bg-carta/60 px-3 py-3 font-mono text-sm outline-none transition focus:border-terracotta"
        >
          {PREFISSI.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          name="telefono"
          required
          type="tel"
          placeholder="Cellulare (es. 333 123 4567)"
          defaultValue={props.precompilato?.telefono}
          className={campo}
        />
      </div>
      <input
        name="email"
        type="email"
        placeholder="Email (facoltativa)"
        defaultValue={props.precompilato?.email}
        className={campo}
      />
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

function LinkGestione({ token }: { token: string }) {
  const [copiato, setCopiato] = useState(false);
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/prenotazione/${token}`;

  async function copia() {
    await navigator.clipboard.writeText(link);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
  }

  return (
    <div className="mt-5 rounded-xl border-2 border-terracotta bg-terracotta/10 p-4">
      <p className="text-sm font-semibold text-crema">
        ⚠️ Salva questo link: è l'unico modo per annullare o cambiare orario.
      </p>
      <button
        onClick={copia}
        className="mt-2.5 w-full rounded-xl bg-terracotta py-2.5 text-sm font-semibold text-crema transition hover:opacity-90"
      >
        {copiato ? 'Copiato ✓' : '🔗 Copia il link della prenotazione'}
      </button>
    </div>
  );
}

const formattaICS = (d: DateTime) => d.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

const escapeICS = (testo: string) =>
  testo.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// "Aggiungi al calendario": Google Calendar via link (nessun file, apre
// direttamente); per Apple/Outlook/altri si genera un .ics al volo nel
// browser, senza nessuna rotta né dato aggiuntivo sul server — nessun
// luogo (non ancora un campo del salone), solo titolo, orario e link di
// gestione nella descrizione.
function AggiungiAlCalendario(props: {
  titolo: string;
  descrizione: string;
  inizio: string;
  durataMinuti: number;
}) {
  const inizio = DateTime.fromISO(props.inizio);
  const fine = inizio.plus({ minutes: props.durataMinuti });

  const googleUrl = (() => {
    const parametri = new URLSearchParams({
      action: 'TEMPLATE',
      text: props.titolo,
      dates: `${formattaICS(inizio)}/${formattaICS(fine)}`,
      details: props.descrizione,
    });
    return `https://calendar.google.com/calendar/render?${parametri.toString()}`;
  })();

  function scaricaIcs() {
    const contenuto = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Puntuale//Prenotazioni//IT',
      'BEGIN:VEVENT',
      `UID:${crypto.randomUUID()}@puntuale.app`,
      `DTSTAMP:${formattaICS(DateTime.utc())}`,
      `DTSTART:${formattaICS(inizio)}`,
      `DTEND:${formattaICS(fine)}`,
      `SUMMARY:${escapeICS(props.titolo)}`,
      `DESCRIPTION:${escapeICS(props.descrizione)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([contenuto], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'appuntamento.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-4">
      <p className="text-xs text-crema/60">Aggiungi il promemoria al calendario:</p>
      <div className="mt-1.5 flex gap-2">
        <a
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl border border-crema/30 py-2 text-center text-sm font-medium transition hover:bg-crema/10"
        >
          📅 Google Calendar
        </a>
        <button
          onClick={scaricaIcs}
          className="flex-1 rounded-xl border border-crema/30 py-2 text-sm font-medium transition hover:bg-crema/10"
        >
          📥 Apple / Outlook
        </button>
      </div>
    </div>
  );
}
