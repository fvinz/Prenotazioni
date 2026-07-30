import { describe, it, expect } from 'vitest';
import {
  giorniPrenotabili,
  raggruppaSlotPerFascia,
  unisciSlot,
  weekdayAggregati,
} from './widget-utils';

const TZ = 'Europe/Rome';

describe('giorniPrenotabili', () => {
  // 2026-07-17 è un venerdì (weekday Postgres = 5).
  const NOW = '2026-07-17T10:00:00+02:00';

  it('parte da oggi e copre esattamente horizonDays giorni', () => {
    const giorni = giorniPrenotabili({
      now: NOW,
      timezone: TZ,
      horizonDays: 14,
      weekdayDisponibili: [1, 2, 3, 4, 5, 6],
    });
    expect(giorni).toHaveLength(14);
    expect(giorni[0].data).toBe('2026-07-17');
    expect(giorni[13].data).toBe('2026-07-30');
  });

  it('marca non disponibili i giorni senza fasce (es. domenica e lunedì)', () => {
    const giorni = giorniPrenotabili({
      now: NOW,
      timezone: TZ,
      horizonDays: 7,
      weekdayDisponibili: [2, 3, 4, 5, 6], // chiuso dom (0) e lun (1)
    });
    const domenica = giorni.find((g) => g.data === '2026-07-19')!;
    const lunedi = giorni.find((g) => g.data === '2026-07-20')!;
    const martedi = giorni.find((g) => g.data === '2026-07-21')!;
    expect(domenica.weekday).toBe(0);
    expect(domenica.disponibile).toBe(false);
    expect(lunedi.disponibile).toBe(false);
    expect(martedi.disponibile).toBe(true);
  });

  it('le etichette sono in italiano', () => {
    const [oggi] = giorniPrenotabili({
      now: NOW,
      timezone: TZ,
      horizonDays: 1,
      weekdayDisponibili: [5],
    });
    expect(oggi.etichetta).toBe('ven 17 lug');
  });
});

describe('raggruppaSlotPerFascia', () => {
  it('divide su 13:00 locale', () => {
    const { mattina, pomeriggio } = raggruppaSlotPerFascia([
      { start: 'a', label: '09:00' },
      { start: 'b', label: '12:45' },
      { start: 'c', label: '13:00' },
      { start: 'd', label: '17:30' },
    ]);
    expect(mattina.map((s) => s.label)).toEqual(['09:00', '12:45']);
    expect(pomeriggio.map((s) => s.label)).toEqual(['13:00', '17:30']);
  });
});

describe('unisciSlot', () => {
  it('deduplica per orario e ordina il risultato', () => {
    const unito = unisciSlot([
      [
        { start: '2026-07-20T09:00:00Z', label: '11:00' },
        { start: '2026-07-20T10:00:00Z', label: '12:00' },
      ],
      [
        { start: '2026-07-20T08:00:00Z', label: '10:00' },
        { start: '2026-07-20T09:00:00Z', label: '11:00' }, // stesso orario, altro operatore
      ],
    ]);
    expect(unito.map((s) => s.start)).toEqual([
      '2026-07-20T08:00:00Z',
      '2026-07-20T09:00:00Z',
      '2026-07-20T10:00:00Z',
    ]);
  });

  it('nessun operatore libero: nessuno slot', () => {
    expect(unisciSlot([[], []])).toEqual([]);
  });
});

describe('weekdayAggregati', () => {
  it('unisce le fasce dei soli operatori indicati', () => {
    const risultato = weekdayAggregati(
      { a: [1, 3, 5], b: [2, 3], c: [6] },
      ['a', 'b'],
    );
    expect(risultato.sort()).toEqual([1, 2, 3, 5]);
  });

  it('ignora operatori senza fasce registrate', () => {
    expect(weekdayAggregati({}, ['sconosciuto'])).toEqual([]);
  });
});
