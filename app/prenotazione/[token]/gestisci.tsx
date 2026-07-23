'use client';

// Gestione della prenotazione dal link personale: vedi i dettagli,
// annulla o cambia orario. Il cambio orario riusa la striscia dei giorni
// e la griglia degli orari del widget pubblico (stesso componente,
// stesso collaudo) ma invece di creare una prenotazione ne aggiorna una
// esistente, tramite reschedule_booking_by_token.

import { useState } from 'react';
import { DateTime } from 'luxon';
import type { FreeSlot } from '@/lib/slots';
import { StrisciaGiorni, SceltaOrario } from '../../[tenantSlug]/widget';
import type { GiornoPrenotabile } from '@/lib/widget-utils';

export interface DatiPrenotazione {
  token: string;
  status: string;
  startsAt: string;
  tenant: { name: string; slug: string; timezone: string; horizonDays: number };
  servizio: { id: string; name: string; priceCents: number };
  operatore: { id: string; name: string };
  weekdayDisponibili: number[];
  /** Oltre questo istante, annullare/cambiare orario richiede di contattare il salone. */
  modificaEntro: string | null;
}

const euro = (cents: number) =>
  (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

type Vista = 'dettagli' | 'cambia-orario' | 'annullata' | 'riprogrammata';

export function GestisciPrenotazione({ dati }: { dati: DatiPrenotazione }) {
  const [vista, setVista] = useState<Vista>('dettagli');
  const [nuovoOrario, setNuovoOrario] = useState<{ giorno: GiornoPrenotabile; slot: FreeSlot } | null>(
    null,
  );
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  const inizio = DateTime.fromISO(dati.startsAt).setZone(dati.tenant.timezone).setLocale('it');
  const scaduto =
    dati.modificaEntro === null || DateTime.now() > DateTime.fromISO(dati.modificaEntro);
  const modificabile = dati.status === 'confirmed' && !scaduto;

  async function annulla() {
    if (!window.confirm('Annullare questo appuntamento?')) return;
    setInvio(true);
    setErrore(null);
    const res = await fetch(`/api/prenotazione/${dati.token}/annulla`, { method: 'POST' });
    setInvio(false);
    if (res.ok) {
      setVista('annullata');
      return;
    }
    const json = await res.json().catch(() => ({}));
    setErrore(json.error ?? 'Qualcosa non ha funzionato. Riprova.');
  }

  async function confermaNuovoOrario(slot: FreeSlot, giorno: GiornoPrenotabile) {
    setInvio(true);
    setErrore(null);
    const res = await fetch(`/api/prenotazione/${dati.token}/riprogramma`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nuovoInizio: slot.start }),
    });
    setInvio(false);
    if (res.ok) {
      setNuovoOrario({ giorno, slot });
      setVista('riprogrammata');
      return;
    }
    const json = await res.json().catch(() => ({}));
    setErrore(json.error ?? 'Qualcosa non ha funzionato. Riprova.');
  }

  if (vista === 'annullata') {
    return (
      <div className="rounded-xl bg-inchiostro p-6 text-center text-crema">
        <p className="font-display text-3xl">
          Fatto<span className="text-terracotta">.</span>
        </p>
        <p className="mt-3">Il tuo appuntamento è stato annullato.</p>
      </div>
    );
  }

  if (vista === 'riprogrammata' && nuovoOrario) {
    return (
      <div className="rounded-xl bg-inchiostro p-6 text-center text-crema">
        <p className="font-display text-3xl">
          Fatto<span className="text-terracotta">.</span>
        </p>
        <p className="mt-3">
          {dati.servizio.name} · {nuovoOrario.giorno.etichetta} alle {nuovoOrario.slot.label}.
        </p>
        <p className="mt-1 text-sm text-crema/60">Ti aspettiamo.</p>
      </div>
    );
  }

  if (vista === 'cambia-orario') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-sabbia px-4 py-2 text-sm">
          <span className="truncate">
            {dati.servizio.name} con {dati.operatore.name}
          </span>
          <button
            onClick={() => setVista('dettagli')}
            className="ml-3 shrink-0 font-medium text-terracotta hover:underline"
          >
            ← indietro
          </button>
        </div>
        <SelettoreOrario dati={dati} invio={invio} onScegli={confermaNuovoOrario} />
        {errore && <p className="text-sm text-terracotta">{errore}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sabbia bg-white/60 p-5">
        <p className="font-display text-2xl">{dati.servizio.name}</p>
        <p className="mt-1 capitalize text-inchiostro/70">
          {inizio.toFormat('cccc d LLLL')} alle {inizio.toFormat('HH:mm')} · con {dati.operatore.name}
        </p>
        <p className="mt-1 font-mono text-sm text-inchiostro/50">{euro(dati.servizio.priceCents)}</p>
        {!modificabile && (
          <p className="mt-3 text-sm text-inchiostro/50">
            {dati.status === 'cancelled'
              ? 'Questo appuntamento è stato annullato.'
              : dati.status === 'confirmed' && scaduto
                ? `Non è più possibile annullare o cambiare orario online: mancano meno di 12 ore all'appuntamento. Contatta direttamente ${dati.tenant.name}.`
                : 'Questo appuntamento non è più modificabile.'}
          </p>
        )}
      </div>

      {modificabile && (
        <div className="flex gap-2">
          <button
            onClick={() => setVista('cambia-orario')}
            className="flex-1 rounded-xl bg-terracotta py-2.5 font-semibold text-crema transition hover:opacity-90"
          >
            Cambia orario
          </button>
          <button
            onClick={annulla}
            disabled={invio}
            className="flex-1 rounded-xl border border-terracotta py-2.5 font-semibold text-terracotta transition hover:bg-white/60 disabled:opacity-60"
          >
            Annulla appuntamento
          </button>
        </div>
      )}
      {errore && <p className="text-sm text-terracotta">{errore}</p>}
    </div>
  );
}

function SelettoreOrario({
  dati,
  invio,
  onScegli,
}: {
  dati: DatiPrenotazione;
  invio: boolean;
  onScegli: (slot: FreeSlot, giorno: GiornoPrenotabile) => void;
}) {
  const [giorno, setGiorno] = useState<GiornoPrenotabile | null>(null);
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl">Scegli il nuovo orario</h2>
      <StrisciaGiorni
        horizonDays={dati.tenant.horizonDays}
        weekdayDisponibili={dati.weekdayDisponibili}
        selezionato={giorno?.data}
        onScegli={(g) => setGiorno(g)}
      />
      {giorno && (
        <fieldset disabled={invio} className="disabled:opacity-60">
          <SceltaOrario
            tenantSlug={dati.tenant.slug}
            operatorId={dati.operatore.id}
            serviceId={dati.servizio.id}
            data={giorno.data}
            onScegli={(slot) => onScegli(slot, giorno)}
          />
        </fieldset>
      )}
    </section>
  );
}
