// Funzioni pure di supporto al widget di prenotazione. Nessun HTTP, nessun
// DB: come lib/slots.ts, si collaudano con Vitest.
import { DateTime } from 'luxon';
import type { FreeSlot } from './slots';

/** Un giorno del calendario del widget. */
export interface GiornoPrenotabile {
  /** 'YYYY-MM-DD' nel fuso del salone. */
  data: string;
  /** 0=domenica ... 6=sabato (convenzione Postgres, come availability). */
  weekday: number;
  /** Etichetta breve per la UI, es. 'sab 18 lug'. */
  etichetta: string;
  /** false se l'operatore non ha fasce in quel giorno della settimana. */
  disponibile: boolean;
}

/**
 * Costruisce la striscia di giorni prenotabili: da oggi (nel fuso del
 * salone) per `horizonDays` giorni. I giorni il cui weekday non compare
 * tra le fasce dell'operatore sono marcati non disponibili.
 */
export function giorniPrenotabili(input: {
  /** Istante di riferimento ISO (di solito "adesso"). */
  now: string;
  timezone: string;
  horizonDays: number;
  /** I weekday (0-6) in cui l'operatore ha almeno una fascia. */
  weekdayDisponibili: number[];
}): GiornoPrenotabile[] {
  const { now, timezone, horizonDays, weekdayDisponibili } = input;
  const oggi = DateTime.fromISO(now).setZone(timezone).startOf('day');
  if (!oggi.isValid) throw new Error(`Istante non valido: ${now}`);

  const disponibili = new Set(weekdayDisponibili);
  const out: GiornoPrenotabile[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const giorno = oggi.plus({ days: i });
    const weekday = giorno.weekday % 7; // Luxon 1-7 (lun-dom) -> Postgres 0-6 (dom-sab)
    out.push({
      data: giorno.toISODate()!,
      weekday,
      etichetta: giorno.setLocale('it').toFormat('ccc d LLL'),
      disponibile: disponibili.has(weekday),
    });
  }
  return out;
}

/** Slot raggruppati per fascia della giornata (per la UI). */
export interface SlotRaggruppati {
  mattina: FreeSlot[];
  pomeriggio: FreeSlot[];
}

/** Divide gli slot in mattina (< 13:00 locale) e pomeriggio (>= 13:00). */
export function raggruppaSlotPerFascia(slots: FreeSlot[]): SlotRaggruppati {
  const mattina: FreeSlot[] = [];
  const pomeriggio: FreeSlot[] = [];
  for (const slot of slots) {
    const ora = Number(slot.label.split(':')[0]);
    (ora < 13 ? mattina : pomeriggio).push(slot);
  }
  return { mattina, pomeriggio };
}
