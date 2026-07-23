// =====================================================================
//  consigli.ts — Motore di consigli della dashboard (LOGICA PURA)
//
//  Come metriche.ts: nessun HTTP, nessun DB. Riceve le metriche già
//  calcolate (periodo corrente + periodo precedente) e la lista dei
//  consigli ignorati dal titolare, restituisce al massimo pochi consigli
//  pronti da mostrare.
//
//  Principio guida: le regole guardano SOGLIE e VARIAZIONI, mai semplici
//  classifiche ("il peggiore della lista") — in qualunque listino
//  qualcuno è sempre l'ultimo, quindi una regola sul minimo scatterebbe
//  sempre, in modo tautologico e quindi banale. Si confronta invece
//  contro una media o contro il periodo precedente.
//
//  Ogni consiglio ha un identificativo STABILE (indipendente dai valori
//  esatti): è la chiave con cui il chiamante verifica se è stato
//  ignorato di recente (tabella consigli_ignorati) e lo filtra.
// =====================================================================

import type { Metriche } from './metriche';

export type TipoConsiglio = 'attenzione' | 'opportunita' | 'positivo';

export type AzioneConsiglio =
  | { kind: 'naviga'; etichetta: string; href: string }
  | { kind: 'whatsapp'; etichetta: string; telefono: string; messaggio: string }
  | { kind: 'copia'; etichetta: string; testo: string }
  | {
      kind: 'modifica_prezzo';
      etichetta: string;
      servizioId: string;
      servizioNome: string;
      prezzoAttualeCents: number;
      prezzoSuggeritoCents: number;
    };

export interface Consiglio {
  /** Stabile: non cambia se cambiano i numeri, solo se cambia il "tipo" di fatto. */
  id: string;
  tipo: TipoConsiglio;
  titolo: string;
  testo: string;
  /** Per ordinare i consigli dello stesso tipo: quanto "pesa" economicamente. */
  impattoCents: number;
  azione?: AzioneConsiglio;
}

const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pct = (x: number) => `${Math.round(x * 100)}%`;

const PESO_TIPO: Record<TipoConsiglio, number> = { attenzione: 2, opportunita: 1, positivo: 0 };

export function generaConsigli(input: {
  corrente: Metriche;
  precedente: Metriche | null;
  /** Identificativi ancora silenziati (già filtrati per data dal chiamante). */
  ignorati: Set<string>;
  /** Percorso della sezione "Da recuperare" nella dashboard, per il collegamento. */
  hrefRecupero: string;
  /** URL pubblico del widget del salone, per l'azione "copia link". */
  urlWidget: string;
  massimo?: number;
}): Consiglio[] {
  const { corrente, precedente, ignorati, hrefRecupero, urlWidget } = input;
  const massimo = input.massimo ?? 5;
  const grezzi: Consiglio[] = [];

  // --- Andamento incasso rispetto al periodo precedente -----------------
  if (precedente && precedente.incassoCents > 0) {
    const variazione = (corrente.incassoCents - precedente.incassoCents) / precedente.incassoCents;
    if (variazione <= -0.15) {
      grezzi.push({
        id: 'incasso_variazione',
        tipo: 'attenzione',
        titolo: 'Incasso in calo',
        testo: `L'incasso di questo periodo è ${pct(Math.abs(variazione))} sotto il periodo precedente (${euro(corrente.incassoCents)} contro ${euro(precedente.incassoCents)}).`,
        impattoCents: precedente.incassoCents - corrente.incassoCents,
      });
    } else if (variazione >= 0.15) {
      grezzi.push({
        id: 'incasso_variazione',
        tipo: 'positivo',
        titolo: 'Incasso in crescita',
        testo: `L'incasso di questo periodo è ${pct(variazione)} sopra il periodo precedente (${euro(corrente.incassoCents)} contro ${euro(precedente.incassoCents)}).`,
        impattoCents: corrente.incassoCents - precedente.incassoCents,
      });
    }
  }

  // --- Giorno debole rispetto alla media degli altri giorni aperti ------
  const giorniAperti = corrente.perGiorno.filter((g) => g.aperto);
  if (giorniAperti.length >= 3) {
    const mediaAltri = (esclusoWeekday: number) => {
      const altri = giorniAperti.filter((g) => g.weekday !== esclusoWeekday);
      return altri.reduce((s, g) => s + g.occupazione, 0) / Math.max(1, altri.length);
    };
    // Il giorno col rapporto peggiore rispetto alla media degli altri,
    // non il primo che incontra la soglia: un solo consiglio, il più utile.
    let peggiore: { giorno: (typeof giorniAperti)[number]; media: number; rapporto: number } | null = null;
    for (const g of giorniAperti) {
      const media = mediaAltri(g.weekday);
      if (media <= 0) continue;
      const rapporto = g.occupazione / media;
      if (rapporto <= 0.5 && (!peggiore || rapporto < peggiore.rapporto)) {
        peggiore = { giorno: g, media, rapporto };
      }
    }
    if (peggiore) {
      grezzi.push({
        id: `giorno_debole:${peggiore.giorno.weekday}`,
        tipo: 'opportunita',
        titolo: 'Un giorno sotto tono',
        testo: `Il ${nomeGiornoEsteso(peggiore.giorno.nome)} riempie il ${pct(peggiore.giorno.occupazione)}, contro una media del ${pct(peggiore.media)} negli altri giorni aperti. Valuta una promozione per quel giorno, per spalmare la clientela sui tempi morti.`,
        impattoCents: 0,
        azione: { kind: 'naviga', etichetta: 'Vai a Orari', href: '/admin/impostazioni#orari' },
      });
    }
  }

  // --- Clienti da recuperare (aggregato) ---------------------------------
  if (corrente.clientiDaRecuperare.length > 0) {
    const valoreTotale = corrente.clientiDaRecuperare.reduce((s, c) => s + c.valoreCents, 0);
    grezzi.push({
      id: 'clienti_da_recuperare',
      tipo: 'opportunita',
      titolo: 'Clienti da recuperare',
      testo: `${corrente.clientiDaRecuperare.length} clienti abituali non tornano da un po', per un valore di ${euro(valoreTotale)}. Un messaggio potrebbe riportarli.`,
      impattoCents: valoreTotale,
      azione: { kind: 'naviga', etichetta: 'Vedi la lista', href: hrefRecupero },
    });
  }

  // --- Operatore con no-show anomalo (richiede un campione minimo) ------
  const operatoriConCampione = corrente.perOperatore.filter((o) => o.nAppuntamenti >= 8);
  if (operatoriConCampione.length >= 2) {
    const mediaNoShow =
      operatoriConCampione.reduce((s, o) => s + o.tassoNoShow, 0) / operatoriConCampione.length;
    for (const o of operatoriConCampione) {
      if (mediaNoShow > 0 && o.tassoNoShow >= mediaNoShow * 1.5 && o.tassoNoShow >= 0.1) {
        grezzi.push({
          id: `noshow_operatore:${o.id}`,
          tipo: 'attenzione',
          titolo: 'No-show sopra la media',
          testo: `${o.nome} ha un tasso di no-show del ${pct(o.tassoNoShow)}, contro una media del ${pct(mediaNoShow)} nel salone.`,
          impattoCents: 0,
          azione: { kind: 'naviga', etichetta: 'Vai alle Metriche', href: '/admin/metriche#per-operatore' },
        });
      }
    }
  }

  // --- Servizio con resa oraria bassa (richiede un campione minimo) -----
  const serviziConCampione = corrente.perServizio.filter((s) => s.n >= 5);
  if (serviziConCampione.length >= 2) {
    // La resa oraria per servizio non è nell'aggregato Metriche: la si
    // approssima con incasso/servizio diviso dal numero di appuntamenti,
    // confrontata in proporzione tra i servizi (basta a individuare
    // l'anomalia di prezzo relativo, non serve la cifra esatta per ora).
    const scontrinoMedio = (s: (typeof serviziConCampione)[number]) => s.incassoCents / s.n;
    const mediaScontrini =
      serviziConCampione.reduce((sum, s) => sum + scontrinoMedio(s), 0) / serviziConCampione.length;
    for (const s of serviziConCampione) {
      const sc = scontrinoMedio(s);
      if (mediaScontrini > 0 && sc <= mediaScontrini * 0.6) {
        const suggerito = Math.round((sc * 1.15) / 50) * 50; // arrotondato a 0,50€
        grezzi.push({
          id: `resa_bassa:${s.id}`,
          tipo: 'opportunita',
          titolo: 'Un servizio rende poco',
          testo: `${s.nome} porta in media ${euro(sc)} ad appuntamento, contro ${euro(mediaScontrini)} degli altri servizi. Valuta di rivedere il prezzo.`,
          impattoCents: (mediaScontrini - sc) * s.n,
          azione: {
            kind: 'modifica_prezzo',
            etichetta: 'Aumenta il prezzo',
            servizioId: s.id,
            servizioNome: s.nome,
            // Approssimato con lo scontrino medio del periodo: coincide col
            // prezzo attuale del servizio salvo variazioni avvenute nel
            // periodo stesso. Chi mostra l'azione può comunque correggerlo
            // prima di salvare.
            prezzoAttualeCents: sc,
            prezzoSuggeritoCents: suggerito,
          },
        });
      }
    }
  }

  // --- Canale di prenotazione: quota del widget --------------------------
  const totaleCanale = corrente.perCanale.reduce((s, c) => s + c.n, 0);
  const widget = corrente.perCanale.find((c) => c.canale === 'Widget');
  if (totaleCanale >= 20 && widget) {
    const quota = widget.n / totaleCanale;
    if (quota < 0.3) {
      grezzi.push({
        id: 'canale_widget_basso',
        tipo: 'opportunita',
        titolo: 'Il link si usa poco',
        testo: `Solo il ${pct(quota)} delle prenotazioni arriva dal widget online. Condividilo di più: sui social, in bio, sulla vetrina.`,
        impattoCents: 0,
        azione: { kind: 'copia', etichetta: 'Copia il link', testo: urlWidget },
      });
    } else if (quota >= 0.7) {
      grezzi.push({
        id: 'canale_widget_alto',
        tipo: 'positivo',
        titolo: 'Il link funziona',
        testo: `Il ${pct(quota)} delle prenotazioni arriva dal widget online: continua a condividerlo.`,
        impattoCents: 0,
        azione: { kind: 'copia', etichetta: 'Copia per condividere ancora', testo: urlWidget },
      });
    }
  }

  // --- Filtra gli ignorati, ordina, limita --------------------------------
  return grezzi
    .filter((c) => !ignorati.has(c.id))
    .sort((a, b) => PESO_TIPO[b.tipo] - PESO_TIPO[a.tipo] || b.impattoCents - a.impattoCents)
    .slice(0, massimo);
}

function nomeGiornoEsteso(breve: string): string {
  const MAPPA: Record<string, string> = {
    lun: 'lunedì',
    mar: 'martedì',
    mer: 'mercoledì',
    gio: 'giovedì',
    ven: 'venerdì',
    sab: 'sabato',
    dom: 'domenica',
  };
  return MAPPA[breve] ?? breve;
}
