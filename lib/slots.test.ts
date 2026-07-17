// =====================================================================
//  slots.test.ts — Test della logica pura di generazione slot.
//
//  Esegui con Vitest:   npm i -D vitest   &&   npx vitest run
//
//  I dati sono costruiti in ora locale di Roma e convertiti in istanti,
//  così i test restano leggibili e non fragili rispetto al fuso.
// =====================================================================

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { generaSlotLiberi, type AvailabilityWindow, type BusyInterval } from './slots';

const TZ = 'Europe/Rome';
const DATE = '2026-07-20'; // il giorno della settimana lo ricaviamo, così non è fragile

// Giorno della settimana in convenzione Postgres (0=dom ... 6=sab).
const PG_DOW = DateTime.fromISO(DATE, { zone: TZ }).weekday % 7;

/** Costruisce un istante ISO da un orario locale di Roma nel giorno DATE. */
function romeInstant(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return DateTime.fromISO(DATE, { zone: TZ }).set({ hour: h, minute: m }).toUTC().toISO()!;
}

function fascia(startTime: string, endTime: string): AvailabilityWindow {
  return { weekday: PG_DOW, startTime, endTime };
}

function busy(start: string, end: string): BusyInterval {
  return { startsAt: romeInstant(start), endsAt: romeInstant(end) };
}

describe('generaSlotLiberi', () => {
  it('finestra piena senza prenotazioni: slot a passo regolare', () => {
    const slots = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 0,
      availability: [fascia('09:00', '12:00')],
      bookings: [],
      timeOff: [],
      granularityMinutes: 30,
    });
    // 09:00, 09:30, 10:00, 10:30, 11:00, 11:30 (l'ultimo termina alle 12:00)
    expect(slots.map((s) => s.label)).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    ]);
  });

  it('una prenotazione al centro rimuove solo lo slot che si sovrappone', () => {
    const slots = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 0,
      availability: [fascia('09:00', '12:00')],
      bookings: [busy('10:00', '10:30')],
      timeOff: [],
      granularityMinutes: 30,
    });
    // 10:00 salta; 09:30 e 10:30 restano (contigui, non sovrapposti).
    expect(slots.map((s) => s.label)).toEqual([
      '09:00', '09:30', '10:30', '11:00', '11:30',
    ]);
  });

  it('il buffer allunga il tempo occupato e riduce gli slot in coda', () => {
    const slots = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 15, // occupato = 45 min
      availability: [fascia('09:00', '10:00')],
      bookings: [],
      timeOff: [],
      granularityMinutes: 15,
    });
    // 09:00 (fino 09:45) e 09:15 (fino 10:00). 09:30 finirebbe 10:15 -> fuori.
    expect(slots.map((s) => s.label)).toEqual(['09:00', '09:15']);
  });

  it('una chiusura (time_off) blocca gli slot che la intersecano', () => {
    const slots = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 0,
      availability: [fascia('09:00', '12:00')],
      bookings: [],
      timeOff: [busy('10:00', '11:00')], // pausa pranzo
      granularityMinutes: 30,
    });
    // 09:30 (fino 10:00) ok; 10:00 e 10:30 dentro la chiusura -> via; 11:00 ok.
    expect(slots.map((s) => s.label)).toEqual([
      '09:00', '09:30', '11:00', '11:30',
    ]);
  });

  it('giorno senza disponibilità per quel weekday: nessuno slot', () => {
    const altroGiorno = (PG_DOW + 1) % 7;
    const slots = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 0,
      availability: [{ weekday: altroGiorno, startTime: '09:00', endTime: '18:00' }],
      bookings: [],
      timeOff: [],
    });
    expect(slots).toEqual([]);
  });

  it("con 'now' scarta gli slot già passati", () => {
    const slots = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 0,
      availability: [fascia('09:00', '12:00')],
      bookings: [],
      timeOff: [],
      granularityMinutes: 30,
      now: romeInstant('10:00'),
    });
    // Restano solo gli slot con inizio >= 10:00.
    expect(slots.map((s) => s.label)).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });

  it('lo slot restituisce un istante ISO/UTC coerente (Roma +2 a luglio)', () => {
    const [primo] = generaSlotLiberi({
      date: DATE,
      timezone: TZ,
      serviceDurationMinutes: 30,
      serviceBufferMinutes: 0,
      availability: [fascia('09:00', '09:30')],
      bookings: [],
      timeOff: [],
    });
    expect(primo.start).toBe('2026-07-20T07:00:00.000Z'); // 09:00 Roma = 07:00 UTC
    expect(primo.label).toBe('09:00');
  });
});
