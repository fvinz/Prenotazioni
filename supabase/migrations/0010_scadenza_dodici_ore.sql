-- =====================================================================
--  0010_scadenza_dodici_ore.sql
--
--  Il limite basato sulle ore di apertura effettive (0009) crea una
--  scadenza troppo severa a cavallo del fine settimana (le chiusure
--  spingono la soglia indietro di giorni). Si passa a una regola più
--  semplice e prevedibile per il cliente: 12 ore di calendario prima
--  dell'appuntamento, senza guardare gli orari di apertura.
-- =====================================================================

drop function public.scadenza_modifica_cliente(uuid, timestamptz, text);

create or replace function public.scadenza_modifica_cliente(p_starts_at timestamptz)
returns timestamptz
language sql
immutable
as $$
  select p_starts_at - interval '12 hours';
$$;

-- =====================================================================
--  cancel_booking_by_token: non servono più operatore/fuso orario per
--  calcolare la scadenza.
-- =====================================================================
create or replace function public.cancel_booking_by_token(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status    text;
  v_starts_at timestamptz;
  v_scadenza  timestamptz;
begin
  select status, starts_at into v_status, v_starts_at
  from bookings where management_token = p_token;

  if v_status is null then
    raise exception 'Prenotazione non trovata';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'Questa prenotazione non può più essere modificata';
  end if;

  v_scadenza := public.scadenza_modifica_cliente(v_starts_at);
  if now() > v_scadenza then
    raise exception 'Non è più possibile annullare online: mancano meno di 12 ore all''appuntamento. Contatta direttamente il salone.';
  end if;

  update bookings set status = 'cancelled' where management_token = p_token;
end;
$$;

-- =====================================================================
--  reschedule_booking_by_token: stessa semplificazione sulla scadenza;
--  operatore e fuso orario restano necessari per il controllo del
--  nuovo orario (disponibilità, chiusure), non per la scadenza.
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
  v_starts_at   timestamptz;
  v_duration    int;
  v_buffer      int;
  v_tz          text;
  v_scadenza    timestamptz;
  v_new_ends_at timestamptz;
  v_local_dow   int;
  v_local_start time;
  v_local_end   time;
begin
  select b.id, b.status, b.operator_id, b.tenant_id, b.starts_at,
         s.duration_minutes, s.buffer_minutes, t.timezone
    into v_booking_id, v_status, v_operator_id, v_tenant_id, v_starts_at,
         v_duration, v_buffer, v_tz
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

  v_scadenza := public.scadenza_modifica_cliente(v_starts_at);
  if now() > v_scadenza then
    raise exception 'Non è più possibile cambiare orario online: mancano meno di 12 ore all''appuntamento. Contatta direttamente il salone.';
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

-- =====================================================================
--  get_booking_by_token: stessa forma restituita (modifica_entro esiste
--  già), cambia solo il calcolo interno.
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
  operator_name        text,
  modifica_entro       timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.status, b.starts_at, b.ends_at,
         t.name, t.slug, t.timezone, t.booking_horizon_days,
         s.id, s.name, s.price_cents,
         o.id, o.name,
         public.scadenza_modifica_cliente(b.starts_at)
  from bookings b
  join tenants   t on t.id = b.tenant_id
  join services  s on s.id = b.service_id
  join operators o on o.id = b.operator_id
  where b.management_token = p_token;
$$;

grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;
