-- =====================================================================
--  0009_scadenza_modifica_cliente.sql
--
--  Limite di 8 ore di apertura (non di calendario) entro cui il cliente
--  può ancora annullare o cambiare orario dal proprio link personale:
--  oltre quella soglia deve rivolgersi direttamente al salone. Le "8 ore
--  di apertura" si contano a ritroso sulle fasce di availability
--  dell'operatore (i time_off non sono considerati: sono l'eccezione,
--  non la norma, e complicherebbero il calcolo senza un beneficio reale
--  per questo caso d'uso).
--
--  La correttezza vive qui, non nel widget: la funzione è usata sia per
--  bloccare l'azione (cancel/reschedule_booking_by_token) sia per
--  mostrare per tempo il messaggio giusto (get_booking_by_token).
-- =====================================================================

create or replace function public.scadenza_modifica_cliente(
  p_operator_id uuid,
  p_starts_at   timestamptz,
  p_timezone    text
) returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_remaining_minutes int := 480; -- 8 ore
  v_cursor            timestamptz := p_starts_at;
  v_effective_end     timestamptz;
  v_minuti            int;
  rec                 record;
begin
  for rec in
    with giorni as (
      select (date_trunc('day', p_starts_at at time zone p_timezone) - (n || ' days')::interval)::date as giorno
      from generate_series(0, 60) as n
    ),
    finestre as (
      select
        ((g.giorno::timestamp + a.start_time) at time zone p_timezone) as finestra_inizio,
        ((g.giorno::timestamp + a.end_time)   at time zone p_timezone) as finestra_fine
      from giorni g
      join availability a
        on a.operator_id = p_operator_id
        and a.weekday    = extract(dow from g.giorno)::int
    )
    select finestra_inizio, finestra_fine
    from finestre
    -- Non "finestra_fine <= p_starts_at": escluderebbe anche la parte
    -- della finestra del giorno stesso dell'appuntamento che precede
    -- l'orario di inizio (es. le 09:00-10:00 di un appuntamento delle
    -- 10:00 in una finestra 09:00-13:00). Il ritaglio sul cursore, più
    -- sotto, si occupa comunque di non contare oltre l'orario giusto.
    where finestra_inizio < p_starts_at
    order by finestra_fine desc
  loop
    exit when v_remaining_minutes <= 0;
    if rec.finestra_inizio >= v_cursor then
      continue;
    end if;
    v_effective_end := least(rec.finestra_fine, v_cursor);
    v_minuti := greatest(0, floor(extract(epoch from (v_effective_end - rec.finestra_inizio)) / 60)::int);
    if v_minuti <= 0 then
      continue;
    end if;
    if v_minuti >= v_remaining_minutes then
      return v_effective_end - make_interval(mins => v_remaining_minutes);
    end if;
    v_remaining_minutes := v_remaining_minutes - v_minuti;
    v_cursor := rec.finestra_inizio;
  end loop;

  -- Meno di 8 ore di apertura accumulate negli ultimi 60 giorni: caso
  -- limite (operatore con orari pochissimo estesi). Trattato come
  -- "sempre scaduto", per prudenza.
  return null;
end;
$$;

-- =====================================================================
--  cancel_booking_by_token: stessa firma, ora rispetta la scadenza.
-- =====================================================================
create or replace function public.cancel_booking_by_token(p_token uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status      text;
  v_operator_id uuid;
  v_starts_at   timestamptz;
  v_tz          text;
  v_scadenza    timestamptz;
begin
  select b.status, b.operator_id, b.starts_at, t.timezone
    into v_status, v_operator_id, v_starts_at, v_tz
  from bookings b
  join tenants t on t.id = b.tenant_id
  where b.management_token = p_token;

  if v_status is null then
    raise exception 'Prenotazione non trovata';
  end if;
  if v_status <> 'confirmed' then
    raise exception 'Questa prenotazione non può più essere modificata';
  end if;

  v_scadenza := public.scadenza_modifica_cliente(v_operator_id, v_starts_at, v_tz);
  if v_scadenza is null or now() > v_scadenza then
    raise exception 'Non è più possibile annullare online: mancano meno di 8 ore di apertura del salone. Contatta direttamente il salone.';
  end if;

  update bookings set status = 'cancelled' where management_token = p_token;
end;
$$;

-- =====================================================================
--  reschedule_booking_by_token: stessa firma, ora rispetta la scadenza
--  (calcolata sull'orario ATTUALE della prenotazione, non su quello
--  nuovo proposto).
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

  v_scadenza := public.scadenza_modifica_cliente(v_operator_id, v_starts_at, v_tz);
  if v_scadenza is null or now() > v_scadenza then
    raise exception 'Non è più possibile cambiare orario online: mancano meno di 8 ore di apertura del salone. Contatta direttamente il salone.';
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
--  get_booking_by_token: espone anche la scadenza, così la pagina del
--  cliente può mostrare per tempo il messaggio giusto invece di far
--  scoprire il limite solo al momento del tentativo.
-- =====================================================================
drop function public.get_booking_by_token(uuid);

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
         public.scadenza_modifica_cliente(o.id, b.starts_at, t.timezone)
  from bookings b
  join tenants   t on t.id = b.tenant_id
  join services  s on s.id = b.service_id
  join operators o on o.id = b.operator_id
  where b.management_token = p_token;
$$;

grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;
