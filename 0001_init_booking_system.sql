-- =====================================================================
--  Sistema di prenotazioni multi-tenant — Migration iniziale (Supabase)
--  0001_init_booking_system.sql
--
--  Principi di design:
--   1. Multi-tenant: ogni salone è un "tenant". Ogni riga porta un tenant_id.
--   2. Isolamento blindato dal DATABASE via Row-Level Security (RLS),
--      non dal codice applicativo.
--   3. Doppio-booking impedito dal DATABASE via vincolo di esclusione
--      (EXCLUDE ... USING gist), non da controlli applicativi fragili.
--   4. Prenotazione pubblica (cliente finale, non autenticato) solo tramite
--      una funzione SECURITY DEFINER controllata: mai INSERT diretti da anon.
--
--  Convenzione: identificatori in inglese, commenti in italiano.
--  Fuso orario di default: Europe/Rome.
-- =====================================================================

-- Estensioni necessarie -------------------------------------------------
-- btree_gist: permette di combinare uguaglianza su uuid (operator_id)
-- con l'operatore di overlap (&&) su un range temporale nello stesso
-- vincolo di esclusione.
create extension if not exists btree_gist;

-- =====================================================================
--  TABELLE
-- =====================================================================

-- Saloni (tenant) -------------------------------------------------------
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,            -- usato nell'URL/subdominio del widget
  timezone    text not null default 'Europe/Rome',
  created_at  timestamptz not null default now()
);

-- Membri del salone: mappa gli utenti auth di Supabase al tenant ---------
-- È QUESTA la tabella che collega chi fa login (auth.users) al suo salone,
-- e su cui si appoggiano tutte le policy RLS.
create table tenant_members (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner','staff')),
  created_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- Operatori (chi eroga il servizio: parrucchiere, estetista...) ----------
-- Un operatore non deve necessariamente avere un login: è un'anagrafica.
create table operators (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Servizi (taglio, piega, manicure...) ----------------------------------
create table services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  name             text not null,
  duration_minutes int  not null check (duration_minutes > 0),
  buffer_minutes   int  not null default 0 check (buffer_minutes >= 0), -- pulizia/margine dopo
  price_cents      int  not null default 0 check (price_cents >= 0),
  deposit_cents    int  not null default 0 check (deposit_cents >= 0),  -- acconto (Stripe, in futuro)
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Quale operatore eroga quale servizio (join) ---------------------------
create table operator_services (
  operator_id uuid not null references operators(id) on delete cascade,
  service_id  uuid not null references services(id)  on delete cascade,
  primary key (operator_id, service_id)
);

-- Disponibilità settimanale ricorrente, per operatore -------------------
-- weekday segue extract(dow): 0 = domenica, 1 = lunedì, ... 6 = sabato.
-- Gli orari sono ora LOCALE del salone (interpretati nel suo timezone).
create table availability (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  operator_id uuid not null references operators(id) on delete cascade,
  weekday     int  not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);

-- Chiusure / ferie / blocchi una-tantum ---------------------------------
-- operator_id NULL = tutto il salone chiuso in quel periodo.
create table time_off (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  operator_id uuid references operators(id) on delete cascade,   -- NULL = intero salone
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- Clienti (ospiti, per tenant; nessun login lato cliente) ---------------
-- Deduplicazione per numero di telefono all'interno dello stesso salone.
create table customers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  phone       text not null,
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, phone)
);

-- Prenotazioni (il cuore) -----------------------------------------------
-- NB: ends_at include l'eventuale buffer del servizio, così il tempo
-- realmente occupato dall'operatore è protetto dal vincolo di esclusione.
-- La durata mostrata al cliente resta quella del servizio.
create table bookings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id)   on delete cascade,
  operator_id    uuid not null references operators(id) on delete restrict,
  service_id     uuid not null references services(id)  on delete restrict,
  customer_id    uuid not null references customers(id) on delete restrict,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'confirmed'
                   check (status in ('confirmed','cancelled','completed','no_show')),
  price_cents    int  not null default 0,
  deposit_cents  int  not null default 0,
  payment_status text not null default 'none'
                   check (payment_status in ('none','deposit_paid','paid')),
  reminder_sent_at timestamptz,        -- valorizzato quando il promemoria è stato inviato
  source         text not null default 'widget',
  notes          text,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at),

  -- PREVENZIONE DOPPIO-BOOKING A LIVELLO DI DATABASE.
  -- Due prenotazioni ATTIVE dello stesso operatore non possono avere
  -- intervalli di tempo sovrapposti. Il range '[)' è chiuso a sinistra e
  -- aperto a destra: 10:00–10:30 e 10:30–11:00 NON si sovrappongono.
  constraint bookings_no_overlap
    exclude using gist (
      operator_id with =,
      tstzrange(starts_at, ends_at) with &&
    ) where (status <> 'cancelled')
);

-- Indici utili per le query più frequenti -------------------------------
create index bookings_tenant_start_idx   on bookings (tenant_id, starts_at);
create index bookings_operator_start_idx on bookings (operator_id, starts_at);
create index availability_operator_idx   on availability (operator_id, weekday);
create index time_off_tenant_idx         on time_off (tenant_id, starts_at, ends_at);

-- =====================================================================
--  ROW-LEVEL SECURITY
--  Regola generale: un utente autenticato vede/gestisce SOLO i dati dei
--  tenant di cui è membro. Il cliente finale (anon) non legge dati privati
--  e non inserisce nulla direttamente: prenota solo via RPC (più sotto).
-- =====================================================================

alter table tenants          enable row level security;
alter table tenant_members   enable row level security;
alter table operators        enable row level security;
alter table services         enable row level security;
alter table operator_services enable row level security;
alter table availability     enable row level security;
alter table time_off         enable row level security;
alter table customers        enable row level security;
alter table bookings         enable row level security;

-- Helper: i tenant di cui l'utente corrente è membro.
-- SECURITY DEFINER + STABLE per poter essere usata dentro le policy.
create or replace function public.my_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from tenant_members where user_id = auth.uid();
$$;

-- --- tenant_members: ognuno vede le proprie appartenenze ---------------
create policy tm_select_own on tenant_members
  for select to authenticated
  using (user_id = auth.uid());

-- --- tenants -----------------------------------------------------------
-- Lettura pubblica (le pagine di prenotazione sono pubbliche: nome, slug,
-- timezone non sono dati sensibili). Scrittura solo ai membri.
create policy tenants_public_read on tenants
  for select to anon, authenticated using (true);
create policy tenants_member_write on tenants
  for all to authenticated
  using (id in (select my_tenant_ids()))
  with check (id in (select my_tenant_ids()));

-- Macro di comodo: policy "solo membri del tenant" per le tabelle private.
-- (Le scriviamo esplicitamente tabella per tabella qui sotto.)

-- --- operators ---------------------------------------------------------
create policy operators_public_read on operators
  for select to anon, authenticated using (active);          -- widget: elenco operatori attivi
create policy operators_member_all on operators
  for all to authenticated
  using (tenant_id in (select my_tenant_ids()))
  with check (tenant_id in (select my_tenant_ids()));

-- --- services ----------------------------------------------------------
create policy services_public_read on services
  for select to anon, authenticated using (active);          -- widget: servizi attivi
create policy services_member_all on services
  for all to authenticated
  using (tenant_id in (select my_tenant_ids()))
  with check (tenant_id in (select my_tenant_ids()));

-- --- operator_services -------------------------------------------------
-- Lettura pubblica per il widget (quali servizi fa ogni operatore).
create policy opsvc_public_read on operator_services
  for select to anon, authenticated using (true);
create policy opsvc_member_all on operator_services
  for all to authenticated
  using (operator_id in (select id from operators where tenant_id in (select my_tenant_ids())))
  with check (operator_id in (select id from operators where tenant_id in (select my_tenant_ids())));

-- --- availability ------------------------------------------------------
create policy availability_public_read on availability
  for select to anon, authenticated using (true);            -- widget: per calcolare gli slot
create policy availability_member_all on availability
  for all to authenticated
  using (tenant_id in (select my_tenant_ids()))
  with check (tenant_id in (select my_tenant_ids()));

-- --- time_off ----------------------------------------------------------
create policy timeoff_public_read on time_off
  for select to anon, authenticated using (true);            -- widget: per oscurare gli slot chiusi
create policy timeoff_member_all on time_off
  for all to authenticated
  using (tenant_id in (select my_tenant_ids()))
  with check (tenant_id in (select my_tenant_ids()));

-- --- customers (PRIVATO: nessun accesso anon) --------------------------
create policy customers_member_all on customers
  for all to authenticated
  using (tenant_id in (select my_tenant_ids()))
  with check (tenant_id in (select my_tenant_ids()));

-- --- bookings (PRIVATO: nessun accesso anon; si prenota via RPC) -------
create policy bookings_member_all on bookings
  for all to authenticated
  using (tenant_id in (select my_tenant_ids()))
  with check (tenant_id in (select my_tenant_ids()));

-- =====================================================================
--  RPC PUBBLICA DI PRENOTAZIONE
--  Il cliente finale (anon) non tocca le tabelle: chiama questa funzione.
--  La funzione valida servizio, operatore, disponibilità e chiusure, poi
--  inserisce. Il vincolo di esclusione garantisce l'assenza di overlap
--  anche in caso di due richieste simultanee (race condition).
-- =====================================================================
create or replace function public.create_booking(
  p_tenant_slug    text,
  p_operator_id    uuid,
  p_service_id     uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_customer_email text,
  p_starts_at      timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id   uuid;
  v_tz          text;
  v_duration    int;
  v_buffer      int;
  v_price       int;
  v_deposit     int;
  v_ends_at     timestamptz;
  v_local_dow   int;
  v_local_start time;
  v_local_end   time;
  v_customer_id uuid;
  v_booking_id  uuid;
begin
  -- 1) Risolvi il salone dallo slug
  select id, timezone into v_tenant_id, v_tz
  from tenants where slug = p_tenant_slug;
  if v_tenant_id is null then
    raise exception 'Salone non trovato';
  end if;

  -- 2) Servizio: deve appartenere al salone ed essere attivo
  select duration_minutes, buffer_minutes, price_cents, deposit_cents
    into v_duration, v_buffer, v_price, v_deposit
  from services
  where id = p_service_id and tenant_id = v_tenant_id and active;
  if v_duration is null then
    raise exception 'Servizio non disponibile';
  end if;

  -- 3) L'operatore deve erogare quel servizio ed essere attivo
  if not exists (
    select 1
    from operator_services os
    join operators o on o.id = os.operator_id
    where os.operator_id = p_operator_id
      and os.service_id  = p_service_id
      and o.tenant_id    = v_tenant_id
      and o.active
  ) then
    raise exception 'Operatore non disponibile per questo servizio';
  end if;

  -- Tempo occupato = durata + buffer (protegge l'agenda dell'operatore)
  v_ends_at := p_starts_at + make_interval(mins => v_duration + v_buffer);

  -- 4) Lo slot deve rientrare in una fascia di disponibilità (ora locale)
  v_local_dow   := extract(dow from (p_starts_at at time zone v_tz))::int;
  v_local_start := (p_starts_at at time zone v_tz)::time;
  v_local_end   := (v_ends_at   at time zone v_tz)::time;

  if not exists (
    select 1 from availability a
    where a.operator_id = p_operator_id
      and a.weekday     = v_local_dow
      and a.start_time <= v_local_start
      and a.end_time   >= v_local_end
  ) then
    raise exception 'Orario fuori dalla disponibilità';
  end if;

  -- 5) Non deve cadere in una chiusura/ferie (operatore o intero salone)
  if exists (
    select 1 from time_off t
    where t.tenant_id = v_tenant_id
      and (t.operator_id = p_operator_id or t.operator_id is null)
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'Il salone è chiuso in questo orario';
  end if;

  -- 6) Cliente: upsert con dedup per telefono
  insert into customers (tenant_id, name, phone, email)
  values (v_tenant_id, p_customer_name, p_customer_phone, p_customer_email)
  on conflict (tenant_id, phone) do update
    set name  = excluded.name,
        email = coalesce(excluded.email, customers.email)
  returning id into v_customer_id;

  -- 7) Inserisci la prenotazione. Se un altro cliente ha appena preso lo
  --    stesso slot, il vincolo di esclusione solleva exclusion_violation.
  insert into bookings (
    tenant_id, operator_id, service_id, customer_id,
    starts_at, ends_at, price_cents, deposit_cents, source
  ) values (
    v_tenant_id, p_operator_id, p_service_id, v_customer_id,
    p_starts_at, v_ends_at, v_price, v_deposit, 'widget'
  ) returning id into v_booking_id;

  return v_booking_id;

exception
  when exclusion_violation then
    raise exception 'Questo orario è appena stato prenotato: scegline un altro';
end;
$$;

-- Il cliente finale (anon) e i membri possono chiamare la RPC.
grant execute on function public.create_booking(
  text, uuid, uuid, text, text, text, timestamptz
) to anon, authenticated;

-- =====================================================================
--  Note per le prossime iterazioni (fuori da questa migration):
--   - Generazione slot liberi lato widget (a partire da availability,
--     durata servizio e bookings esistenti).
--   - Wiring pagamenti Stripe sull'acconto (deposit_cents).
--   - Job promemoria che valorizza reminder_sent_at.
--   - Gestione fasce che scavalcano la mezzanotte e ora legale (DST).
--   - Trigger updated_at su bookings, se serve audit.
-- =====================================================================
