// =====================================================================
//  slots.ts — Generazione degli slot liberi (LOGICA PURA)
//
//  Funzione senza effetti collaterali: stessi input -> stesso output.
//  Non conosce HTTP né il database. Riceve dati grezzi già recuperati
//  e restituisce gli orari di inizio disponibili.
//
//  REGOLA CONDIVISA CON create_booking (da tenere allineata!):
//   - Il tempo realmente occupato da una prenotazione è
//       durata_servizio + buffer_servizio
//   - Uno slot è valido solo se [inizio, inizio+durata+buffer) sta
//     INTERAMENTE dentro una fascia di disponibilità e NON si sovrappone
//     ad alcuna prenotazione attiva né ad alcuna chiusura.
//   - Gli intervalli sono semiaperti '[)': 10:00–10:30 e 10:30–11:00
//     NON si sovrappongono (coerente con tstzrange nel database).
//
//  Il fuso orario è gestito con Luxon: le fasce sono in ora LOCALE del
//  salone, prenotazioni e chiusure sono istanti assoluti (ISO/UTC).
//
//  Dipendenza:  npm i luxon   (+  npm i -D @types/luxon)
// =====================================================================

import { DateTime } from 'luxon';

/** Fascia oraria settimanale ricorrente di un operatore (ora locale). */
export interface AvailabilityWindow {
  /** 0=domenica ... 6=sabato (come extract(dow) di Postgres). */
  weekday: number;
  /** 'HH:mm' ora locale del salone. */
  startTime: string;
  /** 'HH:mm' ora locale del salone. */
  endTime: string;
}

/** Intervallo occupato (prenotazione o chiusura), come istanti assoluti. */
export interface BusyInterval {
  /** ISO 8601 con offset o 'Z' (es. '2026-07-20T08:00:00.000Z'). */
  startsAt: string;
  endsAt: string;
}

export interface SlotInput {
  /** Giorno da calcolare, come data locale del salone: 'YYYY-MM-DD'. */
  date: string;
  /** Fuso IANA del salone, es. 'Europe/Rome'. */
  timezone: string;
  serviceDurationMinutes: number;
  serviceBufferMinutes: number;
  /** Fasce dell'operatore (tutte: la funzione filtra per giorno). */
  availability: AvailabilityWindow[];
  /** Prenotazioni ATTIVE dell'operatore che toccano il giorno. */
  bookings: BusyInterval[];
  /** Chiusure/ferie (operatore + intero salone) che toccano il giorno. */
  timeOff: BusyInterval[];
  /** Passo tra gli slot in minuti. Default 15. */
  granularityMinutes?: number;
  /** Se presente (ISO), scarta gli slot già passati. */
  now?: string;
  /** Anticipo minimo in minuti rispetto a 'now'. Default 0. */
  minLeadMinutes?: number;
}

export interface FreeSlot {
  /** Istante d'inizio in ISO/UTC: è ciò che passi a create_booking. */
  start: string;
  /** Etichetta 'HH:mm' in ora locale, per la UI. */
  label: string;
}

/** Sovrapposizione di intervalli semiaperti [a0,a1) e [b0,b1). */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function parseHm(hm: string): [number, number] {
  const [h, m] = hm.split(':').map(Number);
  return [h, m];
}

/**
 * Restituisce gli slot di inizio disponibili per un operatore, in un giorno,
 * per un dato servizio. Ordinati e deduplicati.
 */
export function generaSlotLiberi(input: SlotInput): FreeSlot[] {
  const {
    date,
    timezone,
    serviceDurationMinutes,
    serviceBufferMinutes,
    availability,
    bookings,
    timeOff,
    granularityMinutes = 15,
    now,
    minLeadMinutes = 0,
  } = input;

  // Minuti effettivamente bloccati dalla prenotazione (coerente col DB).
  const occupato = serviceDurationMinutes + serviceBufferMinutes;

  // Mezzanotte del giorno richiesto, nel fuso del salone.
  const dayStart = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  if (!dayStart.isValid) {
    throw new Error(`Data non valida: ${date}`);
  }

  // Luxon: 1=lunedì ... 7=domenica  ->  0=domenica ... 6=sabato (Postgres).
  const pgDow = dayStart.weekday % 7;

  const fasce = availability.filter((a) => a.weekday === pgDow);
  if (fasce.length === 0) return [];

  // Prenotazioni + chiusure -> intervalli di istanti (millisecondi).
  const busy = [...bookings, ...timeOff].map((b) => ({
    start: DateTime.fromISO(b.startsAt).toMillis(),
    end: DateTime.fromISO(b.endsAt).toMillis(),
  }));

  const nowMs =
    now != null ? DateTime.fromISO(now).toMillis() + minLeadMinutes * 60_000 : null;

  const out: FreeSlot[] = [];

  for (const fascia of fasce) {
    const [sh, sm] = parseHm(fascia.startTime);
    const [eh, em] = parseHm(fascia.endTime);

    const windowStart = dayStart.set({ hour: sh, minute: sm });
    const windowEnd = dayStart.set({ hour: eh, minute: em });
    const windowEndMs = windowEnd.toMillis();

    // Candidati passo-passo in ora locale: Luxon fa avanzare l'orologio da
    // parete, mantenendo gli slot allineati a :00/:15/:30/:45 anche col DST.
    let cursor = windowStart;
    while (true) {
      const candidateStart = cursor;
      const candidateEnd = candidateStart.plus({ minutes: occupato });

      const startMs = candidateStart.toMillis();
      const endMs = candidateEnd.toMillis();

      // Il servizio (durata + buffer) deve stare tutto dentro la fascia.
      if (endMs > windowEndMs) break;

      const isPast = nowMs !== null && startMs < nowMs;
      const isBusy = busy.some((b) => overlaps(startMs, endMs, b.start, b.end));

      if (!isPast && !isBusy) {
        out.push({
          start: candidateStart.toUTC().toISO()!,
          label: candidateStart.toFormat('HH:mm'),
        });
      }

      cursor = cursor.plus({ minutes: granularityMinutes });
    }
  }

  // Ordina e deduplica (fasce sovrapposte non dovrebbero esistere, ma per sicurezza).
  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// =====================================================================
//  Bordi noti, volutamente fuori da questa versione:
//   - Fasce che scavalcano la mezzanotte (endTime <= startTime).
//   - Giorni di transizione DST: l'aggiunta di durata+buffer è trattata
//     come durata da parete; l'errore è limitato ai 2 giorni/anno di
//     cambio ora e a orari a cavallo della transizione (irrilevante per
//     gli orari tipici di un salone).
// =====================================================================
