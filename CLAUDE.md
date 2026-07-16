# Sistema di prenotazioni — Brief di sviluppo (handoff per Claude Code)

> **Come usare questo file.** Salvalo come `CLAUDE.md` nella root del repository:
> Claude Code (incluso **Claude Code sul web**, claude.ai/code) lo legge
> automaticamente a ogni sessione, così il contesto non va reincollato. Lo
> sviluppo iniziale avviene sul web, lavorando su un repository GitHub già
> esistente. Le stringhe rivolte all'utente finale vanno scritte in italiano.

---

## 1. Obiettivo e filosofia (leggere prima di tutto)

Stiamo costruendo un **sistema di prenotazioni per attività su appuntamento**
(parrucchieri, estetiste, barber; NON professioni mediche in questa fase).

Punti fermi, non negoziabili, che guidano ogni scelta:

- **È un side business, non una startup da unicorno.** L'obiettivo è una rendita
  ricorrente servendo attività locali. Di conseguenza: **niente over-engineering,
  niente gold-plating.** Meglio poco, solido e manutenibile.
- **Modello "posseduto dall'attività", non marketplace.** Ogni salone possiede i
  propri clienti e i propri dati. **Nessun grafo clienti condiviso tra attività.**
  Questa scelta è deliberata e va rispettata nel data model.
- **Architettura a "layer sottile".** Scriviamo noi solo ciò che è distintivo e a
  basso rischio (modello dati, portale admin, widget, logica slot, dashboard
  metriche). Tutto ciò che, se sbagliato, crea rischio legale o chiamate di
  emergenza lo **deleghiamo a servizi gestiti**: Supabase (auth, DB, isolamento),
  Vercel (hosting/uptime), Stripe (pagamenti), provider SMS/email.
- **La correttezza vive nel DATABASE, non nel codice applicativo.** Isolamento tra
  tenant via Row-Level Security; prevenzione dei doppi-booking via vincolo di
  esclusione Postgres. Il codice applicativo non è l'ultima linea di difesa.
- **Prodotto opinionato.** La personalizzazione per singolo cliente vive nella
  *configurazione*, mai in codice biforcato per cliente.

Perché costruiamo il motore in casa e non usiamo Cal.com: nel 2026 Cal.com ha
spostato il prodotto principale a codice chiuso (l'open source è ora "Cal.diy",
per uso personale/non-produzione) e l'uso commerciale self-hosted/embedded
richiede licenza a pagamento o pricing per-prenotazione. Per il nostro scopo,
un motore stretto e proprio conviene di più.

---

## 2. Stack tecnico

- **Next.js (App Router) + TypeScript**
- **Supabase**: Postgres, Auth, Row-Level Security. Già in uso dall'utente.
- **Vercel**: hosting/deploy. Già in uso.
- **Luxon** per tutta la matematica di date/fusi (mai calcoli UTC a mano).
- **Vitest** per i test.
- **Stripe** (acconti) e **provider SMS/email** (promemoria): PIÙ AVANTI, non ora.
- Tailwind per lo stile (ok, ma il focus iniziale è la logica, non l'estetica).

Costi infrastrutturali attesi: quasi tutto sui tier gratuiti/economici, e
**per-totale, non per-salone** (Supabase e Vercel non scalano col numero di
saloni finché i volumi restano piccoli).

---

## 3. Decisioni di dominio già prese

- **Multi-tenant**: ogni salone è un `tenant`; ogni riga porta `tenant_id`.
- **Cliente finale "guest-first"**: NON crea account. È un'anagrafica di proprietà
  del salone, **deduplicata per numero di telefono** all'interno del tenant.
  L'esercente (e il suo staff) invece SI registra (Supabase Auth + `tenant_members`).
  - ⚠️ **Normalizzare sempre il telefono in E.164** (`+39...`) prima di salvarlo/
    deduplicare, altrimenti la deduplica si sgretola in silenzio.
  - Login cliente opzionale (OTP) è un'evoluzione futura: basterà aggiungere una
    colonna `user_id` nullable a `customers`. Non farlo ora.
- **Multi-operatore**: ogni salone può avere più operatori con disponibilità e
  servizi propri. Un salone con una persona sola è il caso con un operatore.
- **Acconti/pagamenti**: i campi (`deposit_cents`, `payment_status`) esistono già
  nello schema, ma il wiring Stripe arriva dopo.
- **Doppio-booking**: impedito dal DB con un vincolo di esclusione GiST su
  `(operator_id, tstzrange(starts_at, ends_at))` per le prenotazioni non annullate.
- **Prenotazione pubblica**: il cliente anon NON fa INSERT diretti; prenota solo
  via la RPC `create_booking` (SECURITY DEFINER) che valida servizio, operatore,
  disponibilità e chiusure.
- **Generazione slot liberi in TypeScript** come funzione pura (vedi sotto). La
  correttezza finale resta comunque garantita dal DB al momento del `create_booking`.
- **Fuso di default**: `Europe/Rome`, parametrico sul tenant.

---

## 4. File già prodotti — FONTE DI VERITÀ (non rigenerare da zero)

L'utente aggiungerà al repo due file già scritti e concordati. Trattali come
sorgente autorevole; leggili prima di scrivere codice che li usa.

### `supabase/migrations/0001_init_booking_system.sql`
Migration iniziale. Contiene:
- Tabelle: `tenants`, `tenant_members`, `operators`, `services`,
  `operator_services`, `availability`, `time_off`, `customers`, `bookings`.
- `availability.weekday` segue `extract(dow)` di Postgres: **0=domenica … 6=sabato**.
- `bookings.ends_at` **include il buffer** del servizio (durata + buffer): è il
  tempo realmente occupato dall'operatore.
- Vincolo di esclusione `bookings_no_overlap` (richiede l'estensione `btree_gist`).
- RLS su tutte le tabelle: lettura pubblica solo su dati non sensibili
  (tenants, operatori/servizi attivi, availability, time_off); `customers` e
  `bookings` sono privati.
- Funzione `my_tenant_ids()` usata dalle policy.
- RPC pubblica `create_booking(...)` con grant a `anon`.

### `lib/slots.ts`  (+ `lib/slots.test.ts`)
Funzione pura `generaSlotLiberi(input)` → lista di slot liberi. Nessun HTTP,
nessun DB. Usa Luxon per i fusi. **Regola condivisa con `create_booking`, da
tenere SEMPRE allineata**: tempo occupato = `durata + buffer`; intervalli
semiaperti `[)`; uno slot è valido solo se l'intero blocco sta dentro una fascia
e non interseca prenotazioni o chiusure. La suite Vitest copre i casi limite.

---

## 5. Struttura del repository attesa

```
.
├─ CLAUDE.md                      # questo brief
├─ README.md
├─ package.json
├─ tsconfig.json
├─ next.config.js
├─ vitest.config.ts
├─ .gitignore
├─ .env.local.example
├─ supabase/
│  └─ migrations/
│     └─ 0001_init_booking_system.sql   # fornito dall'utente
├─ lib/
│  ├─ slots.ts                    # fornito dall'utente
│  ├─ slots.test.ts               # fornito dall'utente
│  └─ supabase/
│     ├─ browser.ts               # client anon (browser)
│     └─ server.ts                # client lato server
└─ app/
   └─ api/
      └─ slots/
         └─ route.ts              # "porta" sottile → chiama generaSlotLiberi
```

Il widget pubblico e il portale admin arriveranno in sessioni successive; non
crearli ora oltre a placeholder minimi.

---

## 6. Contesto di esecuzione e PRIMO COMPITO (questa sessione)

**Contesto di esecuzione (Claude Code sul web).** Giri su infrastruttura cloud e
lavori su un repository GitHub *già esistente*: cloni il repo, esegui lo script di
setup, modifichi il codice, esegui i test e consegni tramite **pull request** (non
fare push diretto su `main`).

Predisposto dall'utente PRIMA di questa sessione:
- Il repository GitHub esiste già (privato), inizializzato con un README.
- Nella root ci sono già questo `CLAUDE.md` e i tre file forniti
  (`supabase/migrations/0001_init_booking_system.sql`, `lib/slots.ts`,
  `lib/slots.test.ts`). Se non fossero ai percorsi della sezione 5, spostali lì.
- Ambiente: prevedi uno script di setup che esegua `npm install` e assicurati che
  l'ambiente cloud abbia accesso di rete ai domini necessari (registry npm,
  Supabase). Le variabili d'ambiente le fornisce l'utente: **non inventarle e non
  committare segreti**; crea solo `.env.local.example` coi nomi.

**Obiettivo:** scaffolding del progetto + il route `/api/slots` che restituisce gli
slot liberi, con i test verdi. Niente di più: **NON costruire widget o portale** in
questa sessione (la UI si itera meglio in un ambiente con anteprima live; qui
restiamo su logica + test, dove il collaudo sono i test automatici).

1. Scaffolding **Next.js + TypeScript + Tailwind** (App Router) nel repo, con
   `.gitignore` adeguato (`node_modules`, `.next`, `.env*`).
2. Dipendenze: `luxon`, `@supabase/supabase-js`; dev: `@types/luxon`, `vitest`.
   Verifica che i tre file forniti siano ai percorsi della sezione 5.
3. Client Supabase: `lib/supabase/browser.ts` (anon, browser) e
   `lib/supabase/server.ts` (lato server). Crea `.env.local.example` coi soli nomi
   delle variabili (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`),
   nessun valore reale.
4. **RPC `get_busy_intervals`** — nuova migration
   `supabase/migrations/0002_get_busy_intervals.sql`: funzione `SECURITY DEFINER`
   `get_busy_intervals(p_operator_id uuid, p_from timestamptz, p_to timestamptz)`
   che restituisce **solo** `{starts_at, ends_at}` delle prenotazioni attive
   (`status <> 'cancelled'`) e delle chiusure (`time_off`, incluse quelle di salone
   con `operator_id IS NULL`) dell'operatore nel range, con `grant execute ... to
   anon`. Motivo: il route ottiene gli intervalli occupati **senza esporre dati dei
   clienti né la service role key**.
5. `app/api/slots/route.ts` (GET, "porta" sottile, ZERO logica di calcolo dentro):
   legge `tenantSlug`, `operatorId`, `serviceId`, `date`; recupera servizio
   (durata/buffer) e fasce `availability` (letture pubbliche da policy) e chiama
   `get_busy_intervals` per prenotazioni+chiusure del giorno; passa tutto a
   `generaSlotLiberi(...)` di `lib/slots.ts`; risponde con la sola lista di slot in JSON.
6. Configura Vitest e verifica che `npx vitest run` sia **verde** prima di chiudere.
   Lavora a piccoli commit con messaggi chiari.
7. Apri una **pull request** con il riepilogo di cosa è stato creato e dei comandi
   per avviare (`dev`, `test`) e per applicare le migration su Supabase.

---

## 7. Roadmap successiva (NON in questa sessione)

- Widget pubblico di prenotazione (selezione servizio → operatore → giorno →
  slot → dati cliente → conferma via `create_booking`).
- Portale admin (login esercente): agenda, gestione appuntamenti, anagrafica
  clienti con storico, gestione servizi/operatori/disponibilità/chiusure.
- Messaggistica/promemoria (provider SMS/email) con `reminder_sent_at`.
- Pagamenti Stripe sull'acconto (`deposit_cents`).
- **Dashboard metriche** (il vero differenziante: riempimento per fascia,
  no-show rate, valore per cliente, redditività per ora-lavoro, stagionalità).
- Onboarding self-service dei saloni.

---

## 8. Note trasversali

- **GDPR**: custodiamo dati personali di clienti di *altri*. Il salone è titolare,
  la piattaforma è responsabile del trattamento: serviranno informativa sul
  widget, DPA col salone, base giuridica per i promemoria, policy di conservazione.
  Non urgente ora, ma da non dimenticare.
- **Bordi rimandati** (documentati nel codice): fasce che scavalcano la mezzanotte;
  giorni di transizione dell'ora legale. Irrilevanti per gli orari tipici di un
  salone; non spendere tempo su questi ora.

## 9. Come lavorare (istruzioni operative per Claude Code)

- Procedi **in modo incrementale** e chiedi conferma prima di allargare lo scopo
  oltre il "primo compito".
- Il **database è la fonte di verità**: se una regola di dominio cambia, aggiorna
  sia il DB sia `slots.ts` e tienili allineati.
- **Non toccare** la logica dei due file forniti senza segnalarmelo.
- Test verdi prima di considerare finito un pezzo. Commit piccoli e descrittivi.
- Consegna il lavoro come **pull request**, senza push diretto su `main`. Prima di
  azioni irreversibili o che toccano le mie credenziali (merge, deploy), **chiedimi
  conferma**.
