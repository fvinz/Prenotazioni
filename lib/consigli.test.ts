import { describe, it, expect } from 'vitest';
import { generaConsigli } from './consigli';
import type { Metriche } from './metriche';

// Metriche "neutre": nessuna regola dovrebbe scattare. I test aggiungono
// gli scostamenti necessari a far scattare una regola alla volta.
function metricheBase(): Metriche {
  return {
    incassoCents: 100000,
    nCompletati: 100,
    nAppuntamenti: 100,
    tassoNoShow: 0.05,
    tassoCancellazione: 0.05,
    valoreMedioClienteCents: 3000,
    scontrinoMedioCents: 3000,
    resaOrariaCents: 4000,
    oreLavorate: 100,
    nuoviClienti: 10,
    clientiRitorno: 40,
    perGiorno: ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((nome, i) => ({
      weekday: [1, 2, 3, 4, 5, 6, 0][i],
      nome,
      occupazione: 0.6,
      aperto: true,
    })),
    perFasciaOraria: [],
    perCanale: [{ canale: 'Widget', n: 12 }, { canale: 'Manuale', n: 8 }],
    perMese: [],
    perServizio: [
      { id: 'svc1', nome: 'Taglio', incassoCents: 25000, n: 10 },
      { id: 'svc2', nome: 'Barba', incassoCents: 15000, n: 10 },
    ],
    perOperatore: [
      { id: 'op1', nome: 'Giulia', impiego: 0.6, incassoCents: 50000, nAppuntamenti: 20, tassoNoShow: 0.05, resaOrariaCents: 4000, clientiUnici: 15, scontrinoMedioCents: 2500 },
      { id: 'op2', nome: 'Marco', impiego: 0.6, incassoCents: 50000, nAppuntamenti: 20, tassoNoShow: 0.05, resaOrariaCents: 4000, clientiUnici: 15, scontrinoMedioCents: 2500 },
    ],
    topClienti: [],
    clientiDaRecuperare: [],
    clientiInaffidabili: [],
  };
}

const opzioniBase = {
  ignorati: new Set<string>(),
  hrefRecupero: '/admin/metriche#da-recuperare',
  urlWidget: 'https://puntuale.example/demo',
};

describe('generaConsigli — silenzio quando tutto è nella norma', () => {
  it('nessun consiglio su metriche neutre', () => {
    const c = generaConsigli({ corrente: metricheBase(), precedente: null, ...opzioniBase });
    expect(c).toEqual([]);
  });
});

describe('generaConsigli — andamento incasso', () => {
  it('segnala il calo oltre soglia, non un calo modesto', () => {
    const corrente = metricheBase();
    const precedente = { ...metricheBase(), incassoCents: 100000 };
    corrente.incassoCents = 80000; // -20%
    const forte = generaConsigli({ corrente, precedente, ...opzioniBase });
    expect(forte.some((c) => c.id === 'incasso_variazione' && c.tipo === 'attenzione')).toBe(true);

    const lieve = generaConsigli({
      corrente: { ...metricheBase(), incassoCents: 92000 }, // -8%
      precedente,
      ...opzioniBase,
    });
    expect(lieve.some((c) => c.id === 'incasso_variazione')).toBe(false);
  });

  it('segnala la crescita come consiglio positivo', () => {
    const c = generaConsigli({
      corrente: { ...metricheBase(), incassoCents: 130000 },
      precedente: metricheBase(),
      ...opzioniBase,
    });
    const trovato = c.find((x) => x.id === 'incasso_variazione');
    expect(trovato?.tipo).toBe('positivo');
  });
});

describe('generaConsigli — giorno debole', () => {
  it('non scatta su una tautologia: giorni tutti uguali, nessun consiglio', () => {
    const c = generaConsigli({ corrente: metricheBase(), precedente: null, ...opzioniBase });
    expect(c.some((x) => x.id.startsWith('giorno_debole'))).toBe(false);
  });

  it('scatta solo quando un giorno è nettamente sotto la media degli altri', () => {
    const m = metricheBase();
    m.perGiorno = m.perGiorno.map((g) => (g.weekday === 1 ? { ...g, occupazione: 0.1 } : g));
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    const trovato = c.find((x) => x.id === 'giorno_debole:1');
    expect(trovato).toBeDefined();
    expect(trovato!.azione).toEqual({ kind: 'naviga', etichetta: 'Vai a Orari', href: '/admin/impostazioni#orari' });
  });

  it('un giorno chiuso di proposito non genera il consiglio', () => {
    const m = metricheBase();
    m.perGiorno = m.perGiorno.map((g) => (g.weekday === 0 ? { ...g, occupazione: 0, aperto: false } : g));
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    expect(c.some((x) => x.id === 'giorno_debole:0')).toBe(false);
  });
});

describe('generaConsigli — clienti da recuperare', () => {
  it('aggrega la lista in un unico consiglio con collegamento', () => {
    const m = metricheBase();
    m.clientiDaRecuperare = [
      { id: 'c1', nome: 'Anna Rossi', telefono: '+393331234567', giorni: 70, n: 5, valoreCents: 10000 },
      { id: 'c2', nome: 'Luca Bianchi', telefono: null, giorni: 90, n: 3, valoreCents: 6000 },
    ];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    const trovato = c.find((x) => x.id === 'clienti_da_recuperare');
    expect(trovato).toBeDefined();
    expect(trovato!.testo).toContain('2 clienti');
    expect(trovato!.azione).toEqual({ kind: 'naviga', etichetta: 'Vedi la lista', href: opzioniBase.hrefRecupero });
  });
});

describe('generaConsigli — no-show per operatore', () => {
  it('ignora differenze piccole o campioni troppo piccoli', () => {
    const c = generaConsigli({ corrente: metricheBase(), precedente: null, ...opzioniBase });
    expect(c.some((x) => x.id.startsWith('noshow_operatore'))).toBe(false);
  });

  it('segnala un operatore con no-show molto sopra la media del salone', () => {
    const m = metricheBase();
    m.perOperatore = [
      { ...m.perOperatore[0], tassoNoShow: 0.3, nAppuntamenti: 20 },
      { ...m.perOperatore[1], tassoNoShow: 0.05, nAppuntamenti: 20 },
    ];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    expect(c.some((x) => x.id === 'noshow_operatore:op1')).toBe(true);
    expect(c.some((x) => x.id === 'noshow_operatore:op2')).toBe(false);
  });
});

describe('generaConsigli — servizio a resa bassa', () => {
  it('propone un nuovo prezzo arrotondato quando un servizio rende molto meno degli altri', () => {
    const m = metricheBase();
    m.perServizio = [
      { id: 'svc1', nome: 'Taglio', incassoCents: 25000, n: 10 }, // scontrino 2500
      { id: 'svc2', nome: 'Colore', incassoCents: 6000, n: 10 }, // scontrino 600, molto sotto
    ];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    const trovato = c.find((x) => x.id === 'resa_bassa:svc2');
    expect(trovato).toBeDefined();
    expect(trovato!.azione?.kind).toBe('modifica_prezzo');
    if (trovato!.azione?.kind === 'modifica_prezzo') {
      expect(trovato!.azione.prezzoSuggeritoCents).toBeGreaterThan(trovato!.azione.prezzoAttualeCents);
    }
  });
});

describe('generaConsigli — canale di prenotazione', () => {
  it('consiglia di condividere il link quando il widget è sottoutilizzato', () => {
    const m = metricheBase();
    m.perCanale = [{ canale: 'Widget', n: 5 }, { canale: 'Manuale', n: 20 }];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    expect(c.some((x) => x.id === 'canale_widget_basso')).toBe(true);
  });

  it('rinforza positivamente quando il widget domina', () => {
    const m = metricheBase();
    m.perCanale = [{ canale: 'Widget', n: 18 }, { canale: 'Manuale', n: 4 }];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    const trovato = c.find((x) => x.id === 'canale_widget_alto');
    expect(trovato?.tipo).toBe('positivo');
  });

  it('non scatta con pochi dati nel periodo', () => {
    const m = metricheBase();
    m.perCanale = [{ canale: 'Widget', n: 1 }, { canale: 'Manuale', n: 4 }];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    expect(c.some((x) => x.id.startsWith('canale_widget'))).toBe(false);
  });
});

describe('generaConsigli — memoria (ignorati) e limite massimo', () => {
  it('filtra i consigli già ignorati', () => {
    const m = metricheBase();
    m.perCanale = [{ canale: 'Widget', n: 5 }, { canale: 'Manuale', n: 20 }];
    const senzaFiltro = generaConsigli({ corrente: m, precedente: null, ...opzioniBase });
    expect(senzaFiltro.some((c) => c.id === 'canale_widget_basso')).toBe(true);

    const conFiltro = generaConsigli({
      corrente: m,
      precedente: null,
      ...opzioniBase,
      ignorati: new Set(['canale_widget_basso']),
    });
    expect(conFiltro.some((c) => c.id === 'canale_widget_basso')).toBe(false);
  });

  it('rispetta il limite massimo, dando priorità alle attenzioni', () => {
    const m = metricheBase();
    m.perGiorno = m.perGiorno.map((g) => (g.weekday === 1 ? { ...g, occupazione: 0.1 } : g));
    m.clientiDaRecuperare = [
      { id: 'c1', nome: 'Anna', telefono: null, giorni: 70, n: 5, valoreCents: 10000 },
    ];
    m.perOperatore = [
      { ...m.perOperatore[0], tassoNoShow: 0.3, nAppuntamenti: 20 },
      { ...m.perOperatore[1], tassoNoShow: 0.05, nAppuntamenti: 20 },
    ];
    m.perServizio = [
      { id: 'svc1', nome: 'Taglio', incassoCents: 25000, n: 10 },
      { id: 'svc2', nome: 'Colore', incassoCents: 6000, n: 10 },
    ];
    m.perCanale = [{ canale: 'Widget', n: 5 }, { canale: 'Manuale', n: 20 }];
    const c = generaConsigli({ corrente: m, precedente: null, ...opzioniBase, massimo: 2 });
    expect(c).toHaveLength(2);
    expect(c[0].tipo).toBe('attenzione'); // il no-show viene prima delle opportunità
  });
});
