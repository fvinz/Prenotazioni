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
  /** Canale: 'widget' | 'manual' | altro. */
  source?: string;
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
  /** id cliente -> data di creazione ISO, per "nuovi vs di ritorno". */
  clientiCreatoIl?: Record<string, string>;
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
  clientiUnici: number;
  scontrinoMedioCents: number;
}

export interface Metriche {
  incassoCents: number;
  nCompletati: number;
  nAppuntamenti: number;
  tassoNoShow: number;
  tassoCancellazione: number;
  valoreMedioClienteCents: number;
  scontrinoMedioCents: number;
  resaOrariaCents: number;
  oreLavorate: number;
  nuoviClienti: number;
  clientiRitorno: number;
  /** Occupazione media 0..1 per giorno della settimana, lun..dom. */
  perGiorno: { weekday: number; nome: string; occupazione: number }[];
  /** Volume di appuntamenti per ora d'inizio (ore di punta). */
  perFasciaOraria: { ora: number; n: number }[];
  /** Canale di prenotazione: Widget / Manuale / Altro. */
  perCanale: { canale: string; n: number }[];
  perMese: { mese: string; etichetta: string; incassoCents: number; n: number }[];
  perServizio: { id: string; nome: string; incassoCents: number; n: number }[];
  perOperatore: MetricheOperatore[];
  topClienti: { id: string; nome: string; incassoCents: number; n: number }[];
  /** Clienti abituali che non tornano da >= 60 giorni. */
  clientiDaRecuperare: { id: string; nome: string; giorni: number; n: number; valoreCents: number }[];
  /** Clienti con alto tasso di no-show (candidati all'acconto). */
  clientiInaffidabili: { id: string; nome: string; tassoNoShow: number; n: number }[];
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
  const annullate = bookings.filter((b) => b.status === 'cancelled');

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
      clientiUnici: new Set(sueComplete.map((b) => b.customerId)).size,
      scontrinoMedioCents: sueComplete.length > 0 ? Math.round(incasso / sueComplete.length) : 0,
    };
  });

  // --- Volume per ora d'inizio (ore di punta) --------------------------
  const conteggioOra = new Map<number, number>();
  for (const b of nonAnnullate) {
    const ora = DateTime.fromISO(b.startsAt).setZone(timezone).hour;
    conteggioOra.set(ora, (conteggioOra.get(ora) ?? 0) + 1);
  }
  const perFasciaOraria = [...conteggioOra.entries()]
    .map(([ora, n]) => ({ ora, n }))
    .sort((a, b) => a.ora - b.ora);

  // --- Canale di prenotazione -----------------------------------------
  const etichettaCanale = (s?: string) =>
    s === 'widget' ? 'Widget' : s === 'manual' ? 'Manuale' : 'Altro';
  const conteggioCanale = new Map<string, number>();
  for (const b of bookings) {
    const c = etichettaCanale(b.source);
    conteggioCanale.set(c, (conteggioCanale.get(c) ?? 0) + 1);
  }
  const perCanale = [...conteggioCanale.entries()]
    .map(([canale, n]) => ({ canale, n }))
    .sort((a, b) => b.n - a.n);

  // --- Nuovi clienti vs di ritorno nel periodo -------------------------
  const clientiCreatoIl = input.clientiCreatoIl ?? {};
  const clientiDelPeriodo = new Set(nonAnnullate.map((b) => b.customerId));
  let nuoviClienti = 0;
  let clientiRitorno = 0;
  for (const id of clientiDelPeriodo) {
    const creato = clientiCreatoIl[id];
    if (creato && DateTime.fromISO(creato) >= inizio) nuoviClienti += 1;
    else clientiRitorno += 1;
  }

  // --- Clienti da recuperare + inaffidabili ----------------------------
  const ora = DateTime.now();
  interface AggCliente {
    ultimo: number;
    completati: number;
    noShow: number;
    valore: number;
  }
  const aggCliente = new Map<string, AggCliente>();
  for (const b of bookings) {
    const a = aggCliente.get(b.customerId) ?? { ultimo: 0, completati: 0, noShow: 0, valore: 0 };
    const ms = DateTime.fromISO(b.startsAt).toMillis();
    if (b.status === 'completed') {
      a.completati += 1;
      a.valore += b.priceCents;
      if (ms > a.ultimo) a.ultimo = ms;
    } else if (b.status === 'no_show') {
      a.noShow += 1;
    }
    aggCliente.set(b.customerId, a);
  }
  const clientiDaRecuperare = [...aggCliente.entries()]
    .filter(([, a]) => a.completati >= 2 && a.ultimo > 0)
    .map(([id, a]) => ({
      id,
      nome: nomiClienti[id] ?? 'Cliente',
      giorni: Math.floor(ora.diff(DateTime.fromMillis(a.ultimo), 'days').days),
      n: a.completati,
      valoreCents: a.valore,
    }))
    .filter((c) => c.giorni >= 60)
    .sort((a, b) => b.valoreCents - a.valoreCents)
    .slice(0, 8);
  const clientiInaffidabili = [...aggCliente.entries()]
    .map(([id, a]) => ({
      id,
      nome: nomiClienti[id] ?? 'Cliente',
      tassoNoShow: a.completati + a.noShow > 0 ? a.noShow / (a.completati + a.noShow) : 0,
      n: a.completati + a.noShow,
    }))
    .filter((c) => c.n >= 3 && c.tassoNoShow >= 0.25)
    .sort((a, b) => b.tassoNoShow - a.tassoNoShow || b.n - a.n)
    .slice(0, 8);

  // --- Migliori clienti per valore ------------------------------------
  const mappaCliente = new Map<string, { incassoCents: number; n: number }>();
  for (const b of completate) {
    const cur = mappaCliente.get(b.customerId) ?? { incassoCents: 0, n: 0 };
    cur.incassoCents += b.priceCents;
    cur.n += 1;
    mappaCliente.set(b.customerId, cur);
  }
  const topClienti = [...mappaCliente.entries()]
    .map(([id, v]) => ({ id, nome: nomiClienti[id] ?? 'Cliente', ...v }))
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
    tassoCancellazione: bookings.length > 0 ? annullate.length / bookings.length : 0,
    valoreMedioClienteCents: clientiCompletati.size > 0 ? Math.round(incassoCents / clientiCompletati.size) : 0,
    scontrinoMedioCents: completate.length > 0 ? Math.round(incassoCents / completate.length) : 0,
    resaOrariaCents: oreCompletate > 0 ? Math.round(incassoCents / oreCompletate) : 0,
    oreLavorate: Math.round(oreCompletate),
    nuoviClienti,
    clientiRitorno,
    perGiorno,
    perFasciaOraria,
    perCanale,
    perMese,
    perServizio,
    perOperatore,
    topClienti,
    clientiDaRecuperare,
    clientiInaffidabili,
  };
}

// =====================================================================
//  Statistiche del singolo cliente (per la sua scheda).
// =====================================================================

export interface StatCliente {
  valoreTotaleCents: number;
  scontrinoMedioCents: number;
  nCompletati: number;
  tassoNoShow: number;
  operatorePreferito: string | null;
  serviziAbituali: { nome: string; n: number }[];
  /** Giorni medi tra un appuntamento completato e il successivo. */
  frequenzaGiorni: number | null;
  ultimoIso: string | null;
  giorniDaUltimo: number | null;
  prossimoIso: string | null;
}

export function calcolaStatCliente(input: {
  bookings: Prenotazione[];
  operatori: { id: string; name: string }[];
  servizi: { id: string; name: string }[];
  now: string;
}): StatCliente {
  const { bookings, operatori, servizi, now } = input;
  const nomeOp = new Map(operatori.map((o) => [o.id, o.name]));
  const nomeSvc = new Map(servizi.map((s) => [s.id, s.name]));
  const adesso = DateTime.fromISO(now);

  const completate = bookings
    .filter((b) => b.status === 'completed')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const noShow = bookings.filter((b) => b.status === 'no_show');

  const valoreTotaleCents = completate.reduce((s, b) => s + b.priceCents, 0);

  // Operatore più frequentato (sui completati).
  const perOp = new Map<string, number>();
  for (const b of completate) perOp.set(b.operatorId, (perOp.get(b.operatorId) ?? 0) + 1);
  const operatoreTop = [...perOp.entries()].sort((a, b) => b[1] - a[1])[0];

  // Servizi abituali.
  const perSvc = new Map<string, number>();
  for (const b of completate) perSvc.set(b.serviceId, (perSvc.get(b.serviceId) ?? 0) + 1);
  const serviziAbituali = [...perSvc.entries()]
    .map(([id, n]) => ({ nome: nomeSvc.get(id) ?? 'Servizio', n }))
    .sort((a, b) => b.n - a.n);

  // Frequenza media: media degli intervalli tra completati consecutivi.
  let frequenzaGiorni: number | null = null;
  if (completate.length >= 2) {
    let somma = 0;
    for (let i = 1; i < completate.length; i++) {
      somma += DateTime.fromISO(completate[i].startsAt).diff(
        DateTime.fromISO(completate[i - 1].startsAt),
        'days',
      ).days;
    }
    frequenzaGiorni = Math.round(somma / (completate.length - 1));
  }

  const ultimo = completate.length > 0 ? completate[completate.length - 1].startsAt : null;
  const prossimo = bookings
    .filter((b) => b.status === 'confirmed' && DateTime.fromISO(b.startsAt) > adesso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]?.startsAt ?? null;

  return {
    valoreTotaleCents,
    scontrinoMedioCents: completate.length > 0 ? Math.round(valoreTotaleCents / completate.length) : 0,
    nCompletati: completate.length,
    tassoNoShow:
      completate.length + noShow.length > 0
        ? noShow.length / (completate.length + noShow.length)
        : 0,
    operatorePreferito: operatoreTop ? nomeOp.get(operatoreTop[0]) ?? null : null,
    serviziAbituali,
    frequenzaGiorni,
    ultimoIso: ultimo,
    giorniDaUltimo: ultimo ? Math.floor(adesso.diff(DateTime.fromISO(ultimo), 'days').days) : null,
    prossimoIso: prossimo,
  };
}
