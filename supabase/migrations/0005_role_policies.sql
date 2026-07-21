-- =====================================================================
--  0005_role_policies.sql
--
--  Ruoli operativi nel portale: 'owner' (titolare) e 'staff'.
--  Lo staff fa tutto ciò che serve al banco (agenda, prenotazioni,
--  clienti); SOLO il titolare configura l'attività: servizi, operatori,
--  fasce orarie, chiusure e dati del salone.
--
--  Come in tutto il progetto, la barriera vive nel DATABASE: le policy
--  di scrittura sulle tabelle di configurazione passano da 'owner'.
--  customers e bookings restano invariate (lo staff ci lavora).
-- =====================================================================

-- I tenant in cui l'utente corrente è TITOLARE.
create or replace function public.my_owner_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from tenant_members
  where user_id = auth.uid() and role = 'owner';
$$;

-- --- tenants: scrittura solo owner (lettura pubblica già esistente) ----
drop policy tenants_member_write on tenants;
create policy tenants_owner_write on tenants
  for all to authenticated
  using (id in (select my_owner_tenant_ids()))
  with check (id in (select my_owner_tenant_ids()));

-- --- services: lettura ai membri, scrittura solo owner -----------------
drop policy services_member_all on services;
create policy services_member_read on services
  for select to authenticated
  using (tenant_id in (select my_tenant_ids()));
create policy services_owner_all on services
  for all to authenticated
  using (tenant_id in (select my_owner_tenant_ids()))
  with check (tenant_id in (select my_owner_tenant_ids()));

-- --- operators ---------------------------------------------------------
drop policy operators_member_all on operators;
create policy operators_member_read on operators
  for select to authenticated
  using (tenant_id in (select my_tenant_ids()));
create policy operators_owner_all on operators
  for all to authenticated
  using (tenant_id in (select my_owner_tenant_ids()))
  with check (tenant_id in (select my_owner_tenant_ids()));

-- --- availability ------------------------------------------------------
drop policy availability_member_all on availability;
create policy availability_member_read on availability
  for select to authenticated
  using (tenant_id in (select my_tenant_ids()));
create policy availability_owner_all on availability
  for all to authenticated
  using (tenant_id in (select my_owner_tenant_ids()))
  with check (tenant_id in (select my_owner_tenant_ids()));

-- --- time_off ----------------------------------------------------------
drop policy timeoff_member_all on time_off;
create policy timeoff_member_read on time_off
  for select to authenticated
  using (tenant_id in (select my_tenant_ids()));
create policy timeoff_owner_all on time_off
  for all to authenticated
  using (tenant_id in (select my_owner_tenant_ids()))
  with check (tenant_id in (select my_owner_tenant_ids()));

-- --- operator_services: associazioni = configurazione, solo owner ------
drop policy opsvc_member_all on operator_services;
create policy opsvc_owner_all on operator_services
  for all to authenticated
  using (operator_id in
    (select id from operators where tenant_id in (select my_owner_tenant_ids())))
  with check (operator_id in
    (select id from operators where tenant_id in (select my_owner_tenant_ids())));
