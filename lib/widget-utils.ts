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

/**
 * Unisce gli slot liberi di più operatori (modalità "chiunque sia
 * libero" del widget): stesso orario libero per più operatori conta
 * una volta sola. Chi verrà effettivamente assegnato si decide dopo,
 * in create_booking — qui serve solo mostrare cosa si può scegliere.
 */
export function unisciSlot(gruppi: FreeSlot[][]): FreeSlot[] {
  const visti = new Set<string>();
  const out: FreeSlot[] = [];
  for (const slots of gruppi) {
    for (const slot of slots) {
      if (visti.has(slot.start)) continue;
      visti.add(slot.start);
      out.push(slot);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Giorni della settimana prenotabili in modalità "chiunque sia libero":
 * l'unione delle fasce dei soli operatori che erogano quel servizio
 * (non di tutti gli operatori del salone).
 */
export function weekdayAggregati(
  weekdayPerOperatore: Record<string, number[]>,
  operatorIds: string[],
): number[] {
  const set = new Set<number>();
  for (const id of operatorIds) {
    for (const weekday of weekdayPerOperatore[id] ?? []) set.add(weekday);
  }
  return [...set];
}
