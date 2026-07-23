-- =====================================================================
--  0008_gestione_prenotazione.sql
--
--  Link di gestione per il cliente: ogni prenotazione ha un gettone
--  segreto con cui il cliente, senza account, può vedere il proprio
--  appuntamento, annullarlo o cambiarne l'orario — stesso schema già
--  usato per il calendario personale degli operatori (operators.ical_token):
--  nessun accesso diretto alla tabella, solo funzioni SECURITY DEFINER
--  che espongono il minimo indispensabile.
--
--  Il cambio orario riusa le STESSE regole di create_booking
--  (disponibilità, chiusure, vincolo di esclusione sul database): la
--  correttezza resta nel database, non nel codice applicativo.
-- =====================================================================

alter table bookings
  add column management_token uuid not null default gen_random_uuid();

create unique index bookings_management_token_idx on bookings (management_token);

-- create_booking cambia firma: restituisce anche il gettone di gestione,
-- così il widget può mostrare subito il link dopo la conferma.
drop function public.create_booking(text, uuid, uuid, text, text, text, text, timestamptz);

create or replace function public.create_booking(
  p_tenant_slug         text,
  p_operator_id         uuid,
  p_service_id          uuid,
  p_customer_first_name text,
  p_customer_last_name  text,
  p_customer_phone      text,
  p_customer_email      text,
  p_starts_at           timestamptz
) returns table (booking_id uuid, management_token uuid)
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
  v_token       uuid;
begin
  select id, timezone into v_tenant_id, v_tz
  from tenants where slug = p_tenant_slug;
  if v_tenant_id is null then
    raise exception 'Salone non trovato';
  end if;

  select duration_minutes, buffer_minutes, price_cents, deposit_cents
    into v_duration, v_buffer, v_price, v_deposit
  from services
  where id = p_service_id and tenant_id = v_tenant_id and active;
  if v_duration is null then
    raise exception 'Servizio non disponibile';
  end if;

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

  v_ends_at := p_starts_at + make_interval(mins => v_duration + v_buffer);

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

  if exists (
    select 1 from time_off t
    where t.tenant_id = v_tenant_id
      and (t.operator_id = p_operator_id or t.operator_id is null)
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_starts_at, v_ends_at)
  ) then
    raise exception 'Il salone è chiuso in questo orario';
  end if;

  insert into customers (tenant_id, first_name, last_name, phone, email)
  values (v_tenant_id, p_customer_first_name, p_customer_last_name, p_customer_phone, p_customer_email)
  on conflict (tenant_id, phone) do update
    set first_name = excluded.first_name,
        last_name  = excluded.last_name,
        email      = coalesce(excluded.email, customers.email)
  returning id into v_customer_id;

  insert into bookings (
    tenant_id, operator_id, service_id, customer_id,
    starts_at, ends_at, price_cents, deposit_cents, source
  ) values (
    v_tenant_id, p_operator_id, p_service_id, v_customer_id,
    p_starts_at, v_ends_at, v_price, v_deposit, 'widget'
  ) returning id, bookings.management_token into v_booking_id, v_token;

  return query select v_booking_id, v_token;

exception
  when exclusion_violation then
    raise exception 'Questo orario è appena stato prenotato: scegline un altro';
end;
$$;

grant execute on function public.create_booking(
  text, uuid, uuid, text, text, text, text, timestamptz
) to anon, authenticated;

-- =====================================================================
--  Lettura della prenotazione dal gettone: solo i campi che servono al
--  cliente per vederla e per costruire l'eventuale cambio orario.
-- =====================================================================
create or replace function public.get_booking_by_token(p_token uuid)
returns table (
  booking_id           uuid,
  status               text,
  starts_at            timestamptz,
  ends_at              timestamptz,
  tenant_name          text,
  tenant_slug          text,
  tenant_timezone      text,
  booking_horizon_days int,
  service_id           uuid,
  service_name         text,
  service_price_cents  int,
  operator_id          uuid,
  operator_name        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.status, b.starts_at, b.ends_at,
         t.name, t.slug, t.timezone, t.booking_horizon_days,
         s.id, s.name, s.price_cents,
         o.id, o.name
  from bookings b
  join tenants   t on t.id = b.tenant_id
  join services  s on s.id = b.service_id
  join operators o on o.id = b.operator_id
  where b.management_token = p_token;
$$;

grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

-- =====================================================================
--  Annullamento dal gettone.
-- =====================================================================
create or replace function public.cancel_booking_by_token(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from bookings where management_token = p_token;
  if v_status is null then
    raise exception 'Prenotazione non trovata';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'Questa prenotazione non può più essere modificata';
  end if;
  update bookings set status = 'cancelled' where management_token = p_token;
end;
$$;

grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;

-- =====================================================================
--  Cambio orario dal gettone: stesse regole di create_booking (fasce di
--  disponibilità, chiusure); il vincolo di esclusione sul database
--  protegge comunque da sovrapposizioni anche in caso di corsa.
-- =====================================================================
create or replace function public.reschedule_booking_by_token(
  p_token uuid,
  p_new_starts_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_id  uuid;
  v_status      text;
  v_operator_id uuid;
  v_tenant_id   uuid;
  v_duration    int;
  v_buffer      int;
  v_tz          text;
  v_new_ends_at timestamptz;
  v_local_dow   int;
  v_local_start time;
  v_local_end   time;
begin
  select b.id, b.status, b.operator_id, b.tenant_id, s.duration_minutes, s.buffer_minutes, t.timezone
    into v_booking_id, v_status, v_operator_id, v_tenant_id, v_duration, v_buffer, v_tz
  from bookings b
  join services s on s.id = b.service_id
  join tenants  t on t.id = b.tenant_id
  where b.management_token = p_token;

  if v_booking_id is null then
    raise exception 'Prenotazione non trovata';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'Questa prenotazione non può più essere modificata';
  end if;

  v_new_ends_at := p_new_starts_at + make_interval(mins => v_duration + v_buffer);

  v_local_dow   := extract(dow from (p_new_starts_at at time zone v_tz))::int;
  v_local_start := (p_new_starts_at at time zone v_tz)::time;
  v_local_end   := (v_new_ends_at   at time zone v_tz)::time;

  if not exists (
    select 1 from availability a
    where a.operator_id = v_operator_id
      and a.weekday     = v_local_dow
      and a.start_time <= v_local_start
      and a.end_time   >= v_local_end
  ) then
    raise exception 'Orario fuori dalla disponibilità';
  end if;

  if exists (
    select 1 from time_off t
    where t.tenant_id = v_tenant_id
      and (t.operator_id = v_operator_id or t.operator_id is null)
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_new_starts_at, v_new_ends_at)
  ) then
    raise exception 'Il salone è chiuso in questo orario';
  end if;

  update bookings
    set starts_at = p_new_starts_at, ends_at = v_new_ends_at
    where id = v_booking_id;

exception
  when exclusion_violation then
    raise exception 'Questo orario è appena stato prenotato: scegline un altro';
end;
$$;

grant execute on function public.reschedule_booking_by_token(uuid, timestamptz) to anon, authenticated;
