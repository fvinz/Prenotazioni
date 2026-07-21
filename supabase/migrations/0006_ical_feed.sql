-- =====================================================================
--  0006_ical_feed.sql
--
--  Calendario personale dell'operatore: ogni operatore ha un gettone
--  segreto (ical_token) che identifica il suo flusso iCal in sola
--  lettura, a cui abbonarsi da Google/Apple/Outlook.
--
--  Sicurezza:
--   - il token NON è leggibile dal pubblico: ad anon restano concesse
--     solo le colonne non sensibili di operators (privilegi di colonna);
--   - il flusso è servito da una funzione SECURITY DEFINER che risale
--     all'operatore dal token e restituisce solo l'essenziale.
-- =====================================================================

alter table operators
  add column ical_token uuid not null default gen_random_uuid();

create unique index operators_ical_token_idx on operators (ical_token);

-- Ad anon solo le colonne che il widget usa davvero (niente token).
revoke select on table operators from anon;
grant select (id, tenant_id, name, active, created_at) on table operators to anon;

-- Il flusso: appuntamenti attivi dell'operatore da 7 giorni fa in avanti.
-- Con LEFT JOIN un token valido senza appuntamenti restituisce comunque
-- una riga (serve a distinguere "calendario vuoto" da "token errato").
create or replace function public.get_ical_feed(p_token uuid)
returns table (
  operator_name text,
  booking_id    uuid,
  starts_at     timestamptz,
  ends_at       timestamptz,
  service_name  text,
  customer_name text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name, b.id, b.starts_at, b.ends_at, s.name, c.first_name
  from operators o
  left join bookings b
    on b.operator_id = o.id
   and b.status <> 'cancelled'
   and b.starts_at >= now() - interval '7 days'
  left join services  s on s.id = b.service_id
  left join customers c on c.id = b.customer_id
  where o.ical_token = p_token
  order by b.starts_at;
$$;

grant execute on function public.get_ical_feed(uuid) to anon, authenticated;
