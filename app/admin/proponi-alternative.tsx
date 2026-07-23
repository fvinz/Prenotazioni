'use client';

// Dopo un annullamento, il salone propone al cliente orari alternativi:
// il sistema cerca i primi posti liberi equivalenti (stesso servizio e
// operatore, giorni successivi), l'esercente SCEGLIE quali proporre e
// invia un messaggio con un collegamento al widget pubblico, già aperto
// su quel servizio/operatore e con gli orari scelti evidenziati: il
// cliente può accettarne uno o sfogliarne altri da solo, con lo stesso
// widget che userebbe per una prenotazione normale — nessun nuovo
// sistema di gettoni, si riusa quello che c'è già.
// Dalla Fase 3 (promemoria) lo stesso invio diventerà automatico.

import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { FreeSlot } from '@/lib/slots';
import type { Salone } from './comuni';

interface Alternativa {
  /** 'YYYY-MM-DD' locale + slot: chiave = start ISO. */
  etichettaGiorno: string;
  slot: FreeSlot;
}

export function ProponiAlternative(props: {
  salone: Salone;
  servizioId: string;
  servizioNome: string;
  operatoreId: string;
  clienteNome: string;
  clienteTelefono: string;
  vecchioInizio: string; // ISO dell'appuntamento annullato
  onChiudi: () => void;
}) {
  const [alternative, setAlternative] = useState<Alternativa[] | null>(null);
  const [scelte, setScelte] = useState<Set<string>>(new Set());

  // Cerca i posti liberi nei prossimi 14 giorni (fino a 8 proposte).
  useEffect(() => {
    let attivo = true;
    (async () => {
      const oggi = DateTime.now().setZone(props.salone.timezone).startOf('day');
      const giorni = Array.from({ length: 14 }, (_, i) => oggi.plus({ days: i }));
      const risposte = await Promise.all(
        giorni.map((g) => {
          const qs = new URLSearchParams({
            tenantSlug: props.salone.slug,
            operatorId: props.operatoreId,
            serviceId: props.servizioId,
            date: g.toISODate()!,
          });
          return fetch(`/api/slots?${qs}`)
            .then((r) => (r.ok ? r.json() : { slots: [] }))
            .catch(() => ({ slots: [] }));
        }),
      );
      if (!attivo) return;
      const trovate: Alternativa[] = [];
      risposte.forEach((r: { slots: FreeSlot[] }, i) => {
        for (const slot of r.slots) {
          if (trovate.length >= 8) break;
          trovate.push({
            etichettaGiorno: giorni[i].setLocale('it').toFormat('ccc d LLLL'),
            slot,
          });
        }
      });
      setAlternative(trovate);
      setScelte(new Set(trovate.slice(0, 3).map((a) => a.slot.start)));
    })();
    return () => {
      attivo = false;
    };
  }, [props.salone, props.operatoreId, props.servizioId]);

  // Collegamento al widget: pre-compilato su servizio e operatore; se
  // c'è almeno una proposta scelta, apre già il giorno della prima e
  // evidenzia tutte quelle scelte come "Consigliato".
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = useMemo(() => {
    const selezionate = (alternative ?? []).filter((a) => scelte.has(a.slot.start));
    const parametri = new URLSearchParams({
      servizio: props.servizioId,
      operatore: props.operatoreId,
    });
    if (selezionate.length > 0) {
      const primoGiorno = DateTime.fromISO(selezionate[0].slot.start)
        .setZone(props.salone.timezone)
        .toISODate();
      if (primoGiorno) parametri.set('giorno', primoGiorno);
      parametri.set('suggeriti', selezionate.map((a) => a.slot.start).join(','));
    }
    return `${origin}/${props.salone.slug}?${parametri.toString()}`;
  }, [alternative, scelte, props.servizioId, props.operatoreId, props.salone, origin]);

  const messaggio = useMemo(() => {
    const vecchio = DateTime.fromISO(props.vecchioInizio)
      .setZone(props.salone.timezone)
      .setLocale('it');
    return (
      `Ciao ${props.clienteNome}, purtroppo dobbiamo spostare il tuo appuntamento ` +
      `"${props.servizioNome}" di ${vecchio.toFormat('ccc d LLLL')} alle ${vecchio.toFormat('HH:mm')}. ` +
      `Ci scusiamo per il disagio!\n\n` +
      `Scegli il tuo nuovo orario qui: ${link}\n\n${props.salone.name}`
    );
  }, [link, props]);

  const [copiato, setCopiato] = useState(false);

  function alterna(chiave: string) {
    setScelte((prima) => {
      const dopo = new Set(prima);
      if (dopo.has(chiave)) dopo.delete(chiave);
      else dopo.add(chiave);
      return dopo;
    });
  }

  async function copia() {
    await navigator.clipboard.writeText(messaggio);
    setCopiato(true);
    setTimeout(() => setCopiato(false), 2000);
  }

  const whatsapp = `https://wa.me/${props.clienteTelefono.replace(/\D/g, '')}?text=${encodeURIComponent(messaggio)}`;

  return (
    <div
      className="fixed inset-0 z-10 flex items-end justify-center bg-inchiostro/40 p-0 sm:items-center sm:p-6"
      onClick={props.onChiudi}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-crema p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Proponi un'alternativa</h2>
          <button onClick={props.onChiudi} className="text-sm text-terracotta hover:underline">
            Chiudi
          </button>
        </div>
        <p className="mb-3 text-sm text-inchiostro/60">
          Prenotazione annullata. Scegli quali orari proporre a {props.clienteNome}.
        </p>

        {alternative === null ? (
          <p className="text-sm text-inchiostro/60">Cerco i posti liberi…</p>
        ) : alternative.length === 0 ? (
          <p className="rounded-xl bg-sabbia p-3 text-sm">
            Nessun posto libero nei prossimi 14 giorni per questo servizio e operatore.
          </p>
        ) : (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {alternative.map((a) => (
              <label
                key={a.slot.start}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                  scelte.has(a.slot.start)
                    ? 'border-terracotta bg-white/80'
                    : 'border-sabbia bg-white/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={scelte.has(a.slot.start)}
                  onChange={() => alterna(a.slot.start)}
                  className="accent-terracotta"
                />
                <span className="capitalize">
                  {a.etichettaGiorno}
                  <span className="block font-mono">{a.slot.label}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <textarea
          readOnly
          value={messaggio}
          rows={7}
          className="w-full rounded-xl border border-sabbia bg-white/60 px-3 py-2 font-mono text-xs text-inchiostro/80"
          aria-label="Messaggio per il cliente"
        />
        <div className="mt-2 flex gap-2">
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-xl bg-terracotta py-2.5 text-center font-semibold text-crema transition hover:opacity-90"
          >
            Apri WhatsApp
          </a>
          <button
            onClick={copia}
            className="flex-1 rounded-xl border border-terracotta py-2.5 font-semibold text-terracotta transition hover:bg-white/60"
          >
            {copiato ? 'Copiato ✓' : 'Copia messaggio'}
          </button>
        </div>
      </div>
    </div>
  );
}
