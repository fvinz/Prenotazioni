import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { calcolaMetriche, calcolaStatCliente, type Prenotazione } from './metriche';

const TZ = 'Europe/Rome';

function inRoma(data: string, hhmm: string, minuti: number): { startsAt: string; endsAt: string } {
  const [h, m] = hhmm.split(':').map(Number);
  const start = DateTime.fromISO(data, { zone: TZ }).set({ hour: h, minute: m });
  return { startsAt: start.toUTC().toISO()!, endsAt: start.plus({ minutes: minuti }).toUTC().toISO()! };
}

function pren(
  data: string,
  hhmm: string,
  minuti: number,
  status: Prenotazione['status'],
  extra: Partial<Prenotazione> = {},
): Prenotazione {
  return {
    operatorId: 'op1',
    serviceId: 'svc1',
    customerId: 'c1',
    priceCents: 2500,
    status,
    ...inRoma(data, hhmm, minuti),
    ...extra,
  };
}

const base = {
  from: '2026-03-02', // lunedì
  to: '2026-03-08', // domenica (una settimana)
  timezone: TZ,
  operatori: [{ id: 'op1', name: 'Giulia' }, { id: 'op2', name: 'Marco' }],
  servizi: [{ id: 'svc1', name: 'Taglio' }, { id: 'svc2', name: 'Barba' }],
  // Giulia lavora lunedì (weekday 1) 09:00-13:00 = 240 min; Marco niente.
  disponibilita: [{ operatorId: 'op1', weekday: 1, startMin: 540, endMin: 780 }],
  nomiClienti: { c1: 'Anna Rossi', c2: 'Luca Bianchi' },
};

describe('calcolaMetriche', () => {
  it('incasso, no-show e valore medio sui soli completati', () => {
    const m = calcolaMetriche({
      ...base,
      bookings: [
        pren('2026-03-02', '09:00', 30, 'completed', { customerId: 'c1' }),
        pren('2026-03-02', '09:30', 30, 'completed', { customerId: 'c2', priceCents: 4500 }),
        pren('2026-03-02', '10:00', 30, 'no_show'),
        pren('2026-03-02', '10:30', 30, 'cancelled'),
      ],
    });
    expect(m.incassoCents).toBe(7000); // 2500 + 4500
    expect(m.nCompletati).toBe(2);
    expect(m.nAppuntamenti).toBe(3); // esclude solo l'annullata
    expect(m.tassoNoShow).toBeCloseTo(1 / 3); // 1 no-show su 3 (2 compl + 1 ns)
    expect(m.valoreMedioClienteCents).toBe(3500); // 7000 / 2 clienti distinti
  });

  it('impiego operatore = ore occupate / ore disponibili', () => {
    const m = calcolaMetriche({
      ...base,
      bookings: [
        pren('2026-03-02', '09:00', 60, 'completed'), // 60 min occupati
        pren('2026-03-02', '10:00', 60, 'no_show'), // conta come occupato
        pren('2026-03-02', '11:00', 60, 'cancelled'), // NON occupa
      ],
    });
    const giulia = m.perOperatore.find((o) => o.id === 'op1')!;
    // 120 min occupati su 240 disponibili (solo lunedì nel periodo).
    expect(giulia.impiego).toBeCloseTo(0.5);
    // resa oraria: incasso completati (2500) su 1 ora lavorata = 2500/h.
    expect(giulia.resaOrariaCents).toBe(2500);
    const marco = m.perOperatore.find((o) => o.id === 'op2')!;
    expect(marco.impiego).toBe(0); // nessuna disponibilità né lavoro
  });

  it('raggruppa per mese e per servizio', () => {
    const m = calcolaMetriche({
      ...base,
      from: '2026-03-01',
      to: '2026-03-31',
      bookings: [
        pren('2026-03-02', '09:00', 30, 'completed', { serviceId: 'svc1' }),
        pren('2026-03-09', '09:00', 30, 'completed', { serviceId: 'svc2', priceCents: 1500 }),
      ],
    });
    expect(m.perMese).toHaveLength(1);
    expect(m.perMese[0].incassoCents).toBe(4000);
    expect(m.perServizio.map((s) => s.nome)).toEqual(['Taglio', 'Barba']); // ordinati per incasso
  });

  it('scontrino medio, canale e nuovi vs di ritorno', () => {
    const m = calcolaMetriche({
      ...base,
      bookings: [
        pren('2026-03-02', '09:00', 30, 'completed', { customerId: 'c1', source: 'widget' }),
        pren('2026-03-02', '09:30', 30, 'completed', { customerId: 'c2', priceCents: 3500, source: 'manual' }),
      ],
      clientiCreatoIl: {
        c1: '2026-03-02T08:00:00Z', // creato nel periodo -> nuovo
        c2: '2025-01-01T08:00:00Z', // creato prima -> di ritorno
      },
    });
    expect(m.scontrinoMedioCents).toBe(3000); // (2500+3500)/2
    expect(m.perCanale.find((c) => c.canale === 'Widget')!.n).toBe(1);
    expect(m.perCanale.find((c) => c.canale === 'Manuale')!.n).toBe(1);
    expect(m.nuoviClienti).toBe(1);
    expect(m.clientiRitorno).toBe(1);
  });
});

describe('calcolaStatCliente', () => {
  const operatori = [{ id: 'op1', name: 'Giulia' }, { id: 'op2', name: 'Marco' }];
  const servizi = [{ id: 'svc1', name: 'Taglio' }, { id: 'svc2', name: 'Barba' }];

  it('valore, operatore preferito, frequenza e ultimo appuntamento', () => {
    const s = calcolaStatCliente({
      now: '2026-04-01T10:00:00Z',
      operatori,
      servizi,
      bookings: [
        pren('2026-01-01', '09:00', 30, 'completed', { operatorId: 'op1', serviceId: 'svc1' }),
        pren('2026-02-01', '09:00', 30, 'completed', { operatorId: 'op1', serviceId: 'svc1' }),
        pren('2026-03-01', '09:00', 30, 'completed', { operatorId: 'op2', serviceId: 'svc2', priceCents: 1500 }),
        pren('2026-03-15', '09:00', 30, 'no_show', { operatorId: 'op1' }),
      ],
    });
    expect(s.nCompletati).toBe(3);
    expect(s.valoreTotaleCents).toBe(6500); // 2500+2500+1500
    expect(s.operatorePreferito).toBe('Giulia'); // 2 su op1
    expect(s.tassoNoShow).toBeCloseTo(1 / 4); // 1 no-show su 4 (3 compl + 1 ns)
    expect(s.ultimoIso).toContain('2026-03-01');
    // completati a 1/1, 1/2, 1/3 -> intervalli 31 e 28 -> media ~30
    expect(s.frequenzaGiorni).toBe(30);
    expect(s.giorniDaUltimo).toBe(31); // dal 1/3 al 1/4
  });
});
