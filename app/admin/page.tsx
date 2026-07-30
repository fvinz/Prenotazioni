'use client';

// Agenda del portale admin: le prenotazioni del giorno, per operatore.
// Tutte le letture/scritture passano dal client Supabase autenticato:
// è la Row-Level Security a garantire che si vedano solo i dati del
// proprio salone (tenant_members -> my_tenant_ids nelle policy).

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ConfermaAzione, ErroreTemporaneo, Intestazione, useErroreTemporaneo, useSalone } from './comuni';
import { NuovaPrenotazione } from './nuova-prenotazione';
import { ProponiAlternative } from './proponi-alternative';
import { GrigliaAgenda, type Chiusura, type Operatore, type Prenotazione } from './griglia-agenda';

export default function AgendaAdmin() {
  const supabase = getSupabaseBrowserClient();
  const { salone, ruolo, errore: erroreAccesso } = useSalone();

  const [operatori, setOperatori] = useState<Operatore[]>([]);
  const [data, setData] = useState(() => DateTime.now().toISODate()!);
  const [vista, setVista] = useState<'giorno' | 'settimana'>('giorno');
  const [prenotazioni, setPrenotazioni] = useState<Prenotazione[] | null>(null);
  const [chiusure, setChiusure] = useState<Chiusura[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [nuova, setNuova] = useState(false);
  const [proposta, setProposta] = useState<Prenotazione | null>(null);
  const [confermaAzione, setConfermaAzione] = useState<{
    p: Prenotazione;
    stato: 'no_show' | 'cancelled';
  } | null>(null);
  const [erroreAzione, setErroreAzione] = useErroreTemporaneo();

  useEffect(() => {
    if (!salone) return;
    (async () => {
      const { data: ops } = await supabase
        .from('operators')
        .select('id, name')
        .eq('tenant_id', salone.id)
        .order('name');
      setOperatori(ops ?? []);
    })();
  }, [supabase, salone]);

  // Prenotazioni e chiusure dell'intera settimana che contiene il giorno
  // selezionato (sempre, anche in vista Giorno): evita un ricaricamento
  // quando si passa da una vista all'altra, e il volume per un salone
  // piccolo è comunque trascurabile.
  const carica = useCallback(async () => {
    if (!salone) return;
    setPrenotazioni(null);
    const inizio = DateTime.fromISO(data, { zone: salone.timezone }).startOf('week');
    const fine = inizio.plus({ weeks: 1 });
    const [prenotazioniRes, chiusureRes] = await Promise.all([
      supabase
        .from('bookings')
        .select(
          'id, operator_id, service_id, starts_at, ends_at, status, services(name), customers(first_name, last_name, phone, email)',
        )
        .eq('tenant_id', salone.id)
        .gte('starts_at', inizio.toUTC().toISO()!)
        .lt('starts_at', fine.toUTC().toISO()!)
        .order('starts_at'),
      supabase
        .from('time_off')
        .select('id, operator_id, starts_at, ends_at, reason')
        .eq('tenant_id', salone.id)
        .lt('starts_at', fine.toUTC().toISO()!)
        .gt('ends_at', inizio.toUTC().toISO()!),
    ]);
    if (prenotazioniRes.error) {
      setErrore('Non riesco a caricare le prenotazioni. Riprova.');
      return;
    }
    setPrenotazioni(prenotazioniRes.data as unknown as Prenotazione[]);
    setChiusure((chiusureRes.data ?? []) as Chiusura[]);
  }, [supabase, salone, data]);

  useEffect(() => {
    carica();
  }, [carica]);

  function cambiaStato(p: Prenotazione, stato: 'completed' | 'no_show' | 'cancelled') {
    if (stato === 'completed') {
      eseguiCambiaStato(p, stato);
      return;
    }
    setConfermaAzione({ p, stato });
  }

  async function eseguiCambiaStato(p: Prenotazione, stato: 'completed' | 'no_show' | 'cancelled') {
    const precedente = p.status;
    // Ottimistico: la griglia cambia subito, prima che il server risponda.
    // Se il server rifiuta, si torna allo stato precedente e lo si segnala
    // con un banner temporaneo, senza sostituire tutta la pagina.
    setPrenotazioni((prev) =>
      prev ? prev.map((r) => (r.id === p.id ? { ...r, status: stato } : r)) : prev,
    );
    // Dopo un annullamento: proponi subito al cliente gli orari alternativi.
    if (stato === 'cancelled' && p.customers) setProposta(p);

    const { error } = await supabase.from('bookings').update({ status: stato }).eq('id', p.id);
    if (error) {
      setPrenotazioni((prev) =>
        prev ? prev.map((r) => (r.id === p.id ? { ...r, status: precedente } : r)) : prev,
      );
      if (stato === 'cancelled') setProposta(null);
      setErroreAzione('Non sono riuscito ad aggiornare la prenotazione. Riprova.');
    }
  }

  if (erroreAccesso || errore) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <p className="rounded-xl bg-sabbia p-4">{erroreAccesso ?? errore}</p>
      </main>
    );
  }
  if (!salone) {
    return <main className="p-8 text-center text-inchiostro/60">Un attimo…</main>;
  }

  const giorno = DateTime.fromISO(data, { zone: salone.timezone });
  const oggi = DateTime.now().setZone(salone.timezone).toISODate()!;
  const inizioSettimana = giorno.startOf('week');
  const fineSettimana = inizioSettimana.plus({ days: 6 });
  const passo = vista === 'settimana' ? { weeks: 1 } : { days: 1 };

  return (
    <main className="mx-auto flex h-dvh w-full max-w-5xl flex-col px-4 py-8">
      <div className="shrink-0">
        <Intestazione salone={salone} ruolo={ruolo} />

        {/* La modalità (Giorno/Settimana) governa cosa significano le
            frecce e l'etichetta sotto — è la decisione "esterna", quindi
            precede la riga che dipende da essa invece di condividerne la
            riga: erano due decisioni diverse stipate nello stesso
            controllo. Anche il contenitore pieno (bg-sabbia, altrove
            riservato ad avvisi e riepiloghi) dava a questa barra di
            navigazione lo stesso peso di un contenuto importante, quando
            è solo orientamento. */}
        <div className="mb-3 flex w-fit overflow-hidden rounded-lg border border-inchiostro/15 text-sm">
          <button
            onClick={() => setVista('giorno')}
            className={`px-3 py-1 font-medium transition ${
              vista === 'giorno' ? 'bg-inchiostro text-crema' : 'hover:bg-carta/60'
            }`}
          >
            Giorno
          </button>
          <button
            onClick={() => setVista('settimana')}
            className={`px-3 py-1 font-medium transition ${
              vista === 'settimana' ? 'bg-inchiostro text-crema' : 'hover:bg-carta/60'
            }`}
          >
            Settimana
          </button>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-sabbia pb-4 text-sm">
          <button
            onClick={() => setData(giorno.minus(passo).toISODate()!)}
            className="font-medium text-terracotta"
            aria-label={vista === 'settimana' ? 'Settimana precedente' : 'Giorno precedente'}
          >
            ←
          </button>
          <span className="font-medium capitalize">
            {vista === 'settimana'
              ? `${inizioSettimana.setLocale('it').toFormat('d LLL')} – ${fineSettimana.setLocale('it').toFormat('d LLL')}`
              : giorno.setLocale('it').toFormat('cccc d LLLL')}
          </span>
          {data !== oggi && (
            <button
              onClick={() => setData(oggi)}
              className="rounded-lg bg-terracotta px-2 py-1 text-xs font-semibold text-crema transition hover:opacity-90"
            >
              Oggi
            </button>
          )}
          <input
            type="date"
            value={data}
            onChange={(e) => e.target.value && setData(e.target.value)}
            className="rounded-lg border border-inchiostro/10 bg-carta/60 px-2 py-1 text-sm"
            aria-label="Scegli una data"
          />
          <button
            onClick={() => setData(giorno.plus(passo).toISODate()!)}
            className="font-medium text-terracotta"
            aria-label={vista === 'settimana' ? 'Settimana successiva' : 'Giorno successivo'}
          >
            →
          </button>
        </div>

        <button
          onClick={() => setNuova(true)}
          className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-terracotta py-4 text-lg font-semibold text-crema shadow-md shadow-terracotta/30 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-terracotta/40 active:translate-y-0"
        >
          <span aria-hidden="true" className="text-2xl leading-none">+</span>
          Nuova prenotazione
        </button>
      </div>

      {/* Unico riquadro a occupare lo spazio verticale rimasto: solo qui
          scorre, non nella pagina. L'altezza dell'intestazione sopra può
          cambiare (è già successo) senza bisogno di ricalcolare nulla. */}
      <div className="min-h-0 flex-1">
        {prenotazioni === null ? (
          <p className="text-center text-inchiostro/60">Un attimo…</p>
        ) : (
          <GrigliaAgenda
            salone={salone}
            vista={vista}
            giornoISO={data}
            inizioSettimanaISO={inizioSettimana.toISODate()!}
            oggiISO={oggi}
            operatori={operatori}
            prenotazioni={prenotazioni}
            chiusure={chiusure}
            onCambiaStato={cambiaStato}
            onBloccato={carica}
          />
        )}
      </div>

      {confermaAzione && (
        <ConfermaAzione
          titolo={confermaAzione.stato === 'cancelled' ? 'Annullare la prenotazione?' : 'Segnare il no-show?'}
          messaggio={
            confermaAzione.stato === 'cancelled'
              ? 'Il cliente verrà avvisato e potrai proporgli subito un orario alternativo.'
              : 'Il cliente risulterà non presentato per questo appuntamento.'
          }
          testoConferma={confermaAzione.stato === 'cancelled' ? 'Sì, annulla' : 'Sì, segna no-show'}
          onAnnulla={() => setConfermaAzione(null)}
          onConferma={() => {
            eseguiCambiaStato(confermaAzione.p, confermaAzione.stato);
            setConfermaAzione(null);
          }}
        />
      )}

      {proposta && proposta.customers && (
        <ProponiAlternative
          salone={salone}
          servizioId={proposta.service_id}
          servizioNome={proposta.services?.name ?? 'Appuntamento'}
          operatoreId={proposta.operator_id}
          clienteNome={proposta.customers.first_name}
          clienteCognome={proposta.customers.last_name}
          clienteTelefono={proposta.customers.phone}
          clienteEmail={proposta.customers.email}
          vecchioInizio={proposta.starts_at}
          onChiudi={() => setProposta(null)}
        />
      )}

      {nuova && (
        <NuovaPrenotazione
          salone={salone}
          operatori={operatori}
          dataIniziale={data}
          onChiudi={() => setNuova(false)}
          onCreata={() => {
            setNuova(false);
            carica();
          }}
        />
      )}

      <ErroreTemporaneo messaggio={erroreAzione} />
    </main>
  );
}
