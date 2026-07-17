-- =====================================================================
--  0002_get_busy_intervals.sql
--
--  RPC pubblica per il calcolo degli slot liberi lato widget/API.
--
--  Perché esiste: le prenotazioni (bookings) sono PRIVATE via RLS, ma per
--  calcolare gli slot il chiamante anon deve sapere QUANDO l'operatore è
--  occupato. Questa funzione SECURITY DEFINER espone SOLO le coppie
--  {starts_at, ends_at} — nessun dato del cliente, nessun id, nessun
--  bisogno della service role key lato server.
--
--  Contenuto restituito, per l'operatore richiesto nel range [p_from, p_to):
--   - prenotazioni ATTIVE (status <> 'cancelled'); ends_at include già il
--     buffer del servizio (vedi 0001);
--   - chiusure/ferie (time_off) dell'operatore E dell'intero salone
--     (operator_id IS NULL) del tenant a cui l'operatore appartiene.
--
--  Convenzione intervalli: semiaperti '[)', coerente con tstzrange e con
--  generaSlotLiberi in lib/slots.ts.
-- =====================================================================

create or replace function public.get_busy_intervals(
  p_operator_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
) returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.starts_at, b.ends_at
  from bookings b
  where b.operator_id = p_operator_id
    and b.status <> 'cancelled'
    and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_from, p_to)

  union all

  select t.starts_at, t.ends_at
  from time_off t
  where t.tenant_id = (select o.tenant_id from operators o where o.id = p_operator_id)
    and (t.operator_id = p_operator_id or t.operator_id is null)
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_from, p_to);
$$;

-- Il widget (anon) e i membri autenticati possono interrogarla.
grant execute on function public.get_busy_intervals(uuid, timestamptz, timestamptz)
  to anon, authenticated;
