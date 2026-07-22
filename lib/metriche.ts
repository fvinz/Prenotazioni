// =====================================================================
//  metriche.ts — Calcolo delle metriche della dashboard (LOGICA PURA)
//
//  Come slots.ts: nessun HTTP, nessun DB. Riceve le prenotazioni grezze
//  del periodo (già filtrate dal salone via RLS) più i dati di
//  riferimento, e restituisce gli aggregati pronti da disegnare.
//
//  Convenzioni condivise col resto del progetto:
//   - weekday alla Postgres: 0=domenica ... 6=sabato;
//   - "occupato" di una prenotazione = ends_at - starts_at (il buffer è
//     già incluso in ends_at), cioè il tempo realmente bloccato;
//   - incasso = solo prenotazioni 'completed' (il no-show non incassa,
//     gli acconti arriveranno in futuro);
//   - tasso di no-show = no_show / (completed + no_show): un annullamento
//     non è un no-show.
// =====================================================================

import { DateTime } from 'luxon';

export interface Prenotazione {
  operatorId: string;
  serviceId: string;
  customerId: string;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  priceCents: number;
}

export interface FasciaDisp {
  operatorId: string;
  weekday: number;
  /** minuti da mezzanotte, ora locale. */
  startMin: number;
  endMin: number;
}

export interface MetricheInput {
  /** Estremi inclusivi, date locali del salone: 'YYYY-MM-DD'. */
  from: string;
  to: string;
  timezone: string;
  bookings: Prenotazione[];
  operatori: { id: string; name: string }[];
  servizi: { id: string; name: string }[];
  disponibilita: FasciaDisp[];
  /** id cliente -> nome completo, per la classifica. */
  nomiClienti: Record<string, string>;
}

export interface MetricheOperatore {
  id: string;
  nome: string;
  /** 0..1: ore occupate / ore disponibili nel periodo. */
  impiego: number;
  incassoCents: number;
  nAppuntamenti: number;
  tassoNoShow: number;
  /** incasso / ore effettivamente lavorate (completate). */
  resaOrariaCents: number;
}

export interface Metriche {
  incassoCents: number;
  nCompletati: number;
  nAppuntamenti: number;
  tassoNoShow: number;
  valoreMedioClienteCents: number;
  resaOrariaCents: number;
  /** Occupazione media 0..1 per giorno della settimana, lun..dom. */
  perGiorno: { weekday: number; nome: string; occupazione: number }[];
  perMese: { mese: string; etichetta: string; incassoCents: number; n: number }[];
  perServizio: { id: string; nome: string; incassoCents: number; n: number }[];
  perOperatore: MetricheOperatore[];
  topClienti: { nome: string; incassoCents: number; n: number }[];
}

const NOMI_GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const durataMin = (b: Prenotazione) =>
  (DateTime.fromISO(b.endsAt).toMillis() - DateTime.fromISO(b.startsAt).toMillis()) / 60000;

export function calcolaMetriche(input: MetricheInput): Metriche {
  const { from, to, timezone, bookings, operatori, servizi, disponibilita, nomiClienti } = input;

  const inizio = DateTime.fromISO(from, { zone: timezone }).startOf('day');
  const fine = DateTime.fromISO(to, { zone: timezone }).startOf('day');

  // Quante volte cade ciascun giorno della settimana nel periodo.
  const conteggioGiorno = new Array(7).fill(0);
  for (let g = inizio; g <= fine; g = g.plus({ days: 1 })) {
    conteggioGiorno[g.weekday % 7] += 1;
  }

  // Minuti di finestra per (operatore, weekday) e per weekday globale.
  const finestraOpGiorno = new Map<string, number>(); // `${op}|${wd}` -> min
  const finestraGiorno = new Array(7).fill(0);
  for (const f of disponibilita) {
    const min = Math.max(0, f.endMin - f.startMin);
    finestraOpGiorno.set(
      `${f.operatorId}|${f.weekday}`,
      (finestraOpGiorno.get(`${f.operatorId}|${f.weekday}`) ?? 0) + min,
    );
    finestraGiorno[f.weekday] += min;
  }

  const nonAnnullate = bookings.filter((b) => b.status !== 'cancelled');
  const completate = bookings.filter((b) => b.status === 'completed');
  const noShow = bookings.filter((b) => b.status === 'no_show');

  const incassoCents = completate.reduce((s, b) => s + b.priceCents, 0);
  const oreCompletate = completate.reduce((s, b) => s + durataMin(b), 0) / 60;
  const clientiCompletati = new Set(completate.map((b) => b.customerId));

  // --- Occupazione per giorno della settimana (lun..dom) ---------------
  const occupatoGiorno = new Array(7).fill(0);
  for (const b of nonAnnullate) {
    const wd = DateTime.fromISO(b.startsAt).setZone(timezone).weekday % 7;
    occupatoGiorno[wd] += durataMin(b);
  }
  const ordineSettimana = [1, 2, 3, 4, 5, 6, 0]; // lun..dom
  const perGiorno = ordineSettimana.map((wd) => {
    const disp = finestraGiorno[wd] * conteggioGiorno[wd];
    return {
      weekday: wd,
      nome: NOMI_GIORNI[wd],
      occupazione: disp > 0 ? occupatoGiorno[wd] / disp : 0,
    };
  });

  // --- Stagionalità: per mese -----------------------------------------
  const mappaMese = new Map<string, { incassoCents: number; n: number }>();
  for (const b of completate) {
    const m = DateTime.fromISO(b.startsAt).setZone(timezone).toFormat('yyyy-MM');
    const cur = mappaMese.get(m) ?? { incassoCents: 0, n: 0 };
    cur.incassoCents += b.priceCents;
    cur.n += 1;
    mappaMese.set(m, cur);
  }
  const perMese = [...mappaMese.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mese, v]) => ({
      mese,
      etichetta: DateTime.fromISO(`${mese}-01`).setLocale('it').toFormat('LLL yy'),
      ...v,
    }));

  // --- Per servizio ----------------------------------------------------
  const mappaServizio = new Map<string, { incassoCents: number; n: number }>();
  for (const b of completate) {
    const cur = mappaServizio.get(b.serviceId) ?? { incassoCents: 0, n: 0 };
    cur.incassoCents += b.priceCents;
    cur.n += 1;
    mappaServizio.set(b.serviceId, cur);
  }
  const perServizio = servizi
    .map((s) => ({ id: s.id, nome: s.name, ...(mappaServizio.get(s.id) ?? { incassoCents: 0, n: 0 }) }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.incassoCents - a.incassoCents);

  // --- Per operatore ---------------------------------------------------
  const perOperatore: MetricheOperatore[] = operatori.map((o) => {
    const sue = bookings.filter((b) => b.operatorId === o.id);
    const sueComplete = sue.filter((b) => b.status === 'completed');
    const sueNonAnn = sue.filter((b) => b.status !== 'cancelled');
    const sueNoShow = sue.filter((b) => b.status === 'no_show');
    const occupato = sueNonAnn.reduce((s, b) => s + durataMin(b), 0);
    let disponibile = 0;
    for (let wd = 0; wd < 7; wd++) {
      disponibile += (finestraOpGiorno.get(`${o.id}|${wd}`) ?? 0) * conteggioGiorno[wd];
    }
    const incasso = sueComplete.reduce((s, b) => s + b.priceCents, 0);
    const oreLav = sueComplete.reduce((s, b) => s + durataMin(b), 0) / 60;
    return {
      id: o.id,
      nome: o.name,
      impiego: disponibile > 0 ? occupato / disponibile : 0,
      incassoCents: incasso,
      nAppuntamenti: sueComplete.length,
      tassoNoShow:
        sueComplete.length + sueNoShow.length > 0
          ? sueNoShow.length / (sueComplete.length + sueNoShow.length)
          : 0,
      resaOrariaCents: oreLav > 0 ? Math.round(incasso / oreLav) : 0,
    };
  });

  // --- Migliori clienti per valore ------------------------------------
  const mappaCliente = new Map<string, { incassoCents: number; n: number }>();
  for (const b of completate) {
    const cur = mappaCliente.get(b.customerId) ?? { incassoCents: 0, n: 0 };
    cur.incassoCents += b.priceCents;
    cur.n += 1;
    mappaCliente.set(b.customerId, cur);
  }
  const topClienti = [...mappaCliente.entries()]
    .map(([id, v]) => ({ nome: nomiClienti[id] ?? 'Cliente', ...v }))
    .sort((a, b) => b.incassoCents - a.incassoCents)
    .slice(0, 8);

  return {
    incassoCents,
    nCompletati: completate.length,
    nAppuntamenti: nonAnnullate.length,
    tassoNoShow:
      completate.length + noShow.length > 0
        ? noShow.length / (completate.length + noShow.length)
        : 0,
    valoreMedioClienteCents: clientiCompletati.size > 0 ? Math.round(incassoCents / clientiCompletati.size) : 0,
    resaOrariaCents: oreCompletate > 0 ? Math.round(incassoCents / oreCompletate) : 0,
    perGiorno,
    perMese,
    perServizio,
    perOperatore,
    topClienti,
  };
}
