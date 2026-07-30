-- =====================================================================
--  0011_operatore_qualsiasi.sql
--
--  Il widget può ora saltare la scelta dell'operatore ("Chiunque sia
--  libero"): il cliente vede la disponibilità aggregata di tutti gli
--  operatori idonei per il servizio, e l'assegnazione avviene qui, nel
--  database, al momento della prenotazione — mai lato client, per non
--  aprire una finestra di corsa tra "chi sembrava libero" e "chi è
--  davvero libero".
--
--  create_booking cambia firma: p_operator_id accetta NULL ("nessuna
--  preferenza"). Quando NULL, tra gli operatori che erogano il
--  servizio e sono liberi in quell'orario (fascia di disponibilità,
--  nessuna chiusura), si sceglie chi ha meno prenotazioni attive quel
--  giorno — bilancia il carico senza bisogno di configurazione da
--  parte del salone. Se il vincolo di esclusione fa comunque fallire
--  l'inserimento (un altro cliente ha appena preso lo stesso orario
--  con lo stesso operatore), si passa al candidato successivo prima di
--  arrendersi. La funzione restituisce anche l'operatore assegnato,
--  così il widget può mostrarlo in conferma.
-- =====================================================================

drop function public.create_booking(text, uuid, uuid, text, text, text, text, timestamptz);

create or replace function public.create_booking(
  p_tenant_slug         text,
  p_operator_id         uuid,       -- NULL = nessuna preferenza
  p_service_id          uuid,
  p_customer_first_name text,
  p_customer_last_name  text,
  p_customer_phone      text,
  p_customer_email      text,
  p_starts_at           timestamptz
) returns table (booking_id uuid, management_token uuid, operator_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id      uuid;
  v_tz             text;
  v_duration       int;
  v_buffer         int;
  v_price          int;
  v_deposit        int;
  v_ends_at        timestamptz;
  v_local_dow      int;
  v_local_start    time;
  v_local_end      time;
  v_day_start_utc  timestamptz;
  v_day_end_utc    timestamptz;
  v_customer_id    uuid;
  v_booking_id     uuid;
  v_token          uuid;
  v_operator_id    uuid;
  v_any_candidate  boolean := false;
  v_candidate      record;
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

  v_ends_at := p_starts_at + make_interval(mins => v_duration + v_buffer);

  v_local_dow   := extract(dow from (p_starts_at at time zone v_tz))::int;
  v_local_start := (p_starts_at at time zone v_tz)::time;
  v_local_end   := (v_ends_at   at time zone v_tz)::time;

  -- Confini del giorno locale, in UTC: servono a contare le prenotazioni
  -- "di oggi" di un operatore per bilanciare il carico.
  v_day_start_utc := date_trunc('day', p_starts_at at time zone v_tz) at time zone v_tz;
  v_day_end_utc   := v_day_start_utc + interval '1 day';

  -- Anagrafica cliente: una sola volta, indipendentemente da quale
  -- operatore verrà scelto sotto.
  insert into customers (tenant_id, first_name, last_name, phone, email)
  values (v_tenant_id, p_customer_first_name, p_customer_last_name, p_customer_phone, p_customer_email)
  on conflict (tenant_id, phone) do update
    set first_name = excluded.first_name,
        last_name  = excluded.last_name,
        email      = coalesce(excluded.email, customers.email)
  returning id into v_customer_id;

  if p_operator_id is not null then
    -- Percorso invariato: operatore scelto esplicitamente dal cliente.
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

    begin
      insert into bookings (
        tenant_id, operator_id, service_id, customer_id,
        starts_at, ends_at, price_cents, deposit_cents, source
      ) values (
        v_tenant_id, p_operator_id, p_service_id, v_customer_id,
        p_starts_at, v_ends_at, v_price, v_deposit, 'widget'
      ) returning id, bookings.management_token into v_booking_id, v_token;
      v_operator_id := p_operator_id;
    exception
      when exclusion_violation then
        raise exception 'Questo orario è appena stato prenotato: scegline un altro';
    end;

  else
    -- Nessuna preferenza: tra chi eroga il servizio ed è libero in
    -- quell'orario, il candidato con meno prenotazioni attive quel
    -- giorno va per primo (bilancia il carico); a parità, ordine
    -- casuale, per non favorire sempre lo stesso operatore.
    for v_candidate in
      select o.id as operator_id
      from operators o
      join operator_services os on os.operator_id = o.id
      where os.service_id = p_service_id
        and o.tenant_id   = v_tenant_id
        and o.active
        and exists (
          select 1 from availability a
          where a.operator_id = o.id
            and a.weekday     = v_local_dow
            and a.start_time <= v_local_start
            and a.end_time   >= v_local_end
        )
        and not exists (
          select 1 from time_off t
          where t.tenant_id = v_tenant_id
            and (t.operator_id = o.id or t.operator_id is null)
            and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_starts_at, v_ends_at)
        )
      order by (
        select count(*) from bookings b
        where b.operator_id = o.id
          and b.status <> 'cancelled'
          and b.starts_at >= v_day_start_utc
          and b.starts_at <  v_day_end_utc
      ) asc, random()
    loop
      v_any_candidate := true;
      begin
        insert into bookings (
          tenant_id, operator_id, service_id, customer_id,
          starts_at, ends_at, price_cents, deposit_cents, source
        ) values (
          v_tenant_id, v_candidate.operator_id, p_service_id, v_customer_id,
          p_starts_at, v_ends_at, v_price, v_deposit, 'widget'
        ) returning id, bookings.management_token into v_booking_id, v_token;
        v_operator_id := v_candidate.operator_id;
        exit;
      exception
        when exclusion_violation then
          -- Qualcun altro ha appena preso questo operatore in questo
          -- orario: si prova il prossimo candidato della lista.
          continue;
      end;
    end loop;

    if not v_any_candidate then
      raise exception 'Nessun operatore disponibile per questo servizio';
    end if;
    if v_operator_id is null then
      raise exception 'Questo orario è appena stato prenotato: scegline un altro';
    end if;
  end if;

  return query select v_booking_id, v_token, v_operator_id;
end;
$$;

grant execute on function public.create_booking(
  text, uuid, uuid, text, text, text, text, timestamptz
) to anon, authenticated;
