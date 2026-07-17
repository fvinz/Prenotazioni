-- =====================================================================
--  0004_customers_split_name.sql
--
--  Nome e cognome separati in anagrafica clienti (più flessibilità per
--  le comunicazioni future: promemoria, "Ciao {nome}", ecc.).
--
--   - customers.name -> first_name (not null) + last_name (nullable).
--   - Le righe esistenti sono migrate spezzando sul primo spazio.
--   - create_booking cambia firma: p_customer_first_name / _last_name
--     al posto di p_customer_name. La vecchia firma viene rimossa
--     (il widget e l'API si aggiornano nello stesso deploy).
-- =====================================================================

alter table customers
  add column first_name text,
  add column last_name  text;

update customers set
  first_name = split_part(name, ' ', 1),
  last_name  = nullif(btrim(substr(name, length(split_part(name, ' ', 1)) + 1)), '');

alter table customers alter column first_name set not null;
alter table customers drop column name;

-- Vecchia firma: via (insieme al suo grant).
drop function public.create_booking(text, uuid, uuid, text, text, text, timestamptz);

-- Nuova firma con nome e cognome separati. Il corpo è identico alla
-- versione di 0001 salvo l'upsert del cliente.
create or replace function public.create_booking(
  p_tenant_slug         text,
  p_operator_id         uuid,
  p_service_id          uuid,
  p_customer_first_name text,
  p_customer_last_name  text,
  p_customer_phone      text,
  p_customer_email      text,
  p_starts_at           timestamptz
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
  insert into customers (tenant_id, first_name, last_name, phone, email)
  values (v_tenant_id, p_customer_first_name, p_customer_last_name, p_customer_phone, p_customer_email)
  on conflict (tenant_id, phone) do update
    set first_name = excluded.first_name,
        last_name  = excluded.last_name,
        email      = coalesce(excluded.email, customers.email)
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

grant execute on function public.create_booking(
  text, uuid, uuid, text, text, text, text, timestamptz
) to anon, authenticated;
