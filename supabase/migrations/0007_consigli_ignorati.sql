-- =====================================================================
--  0007_consigli_ignorati.sql
--
--  Memoria dei consigli della dashboard: quando il titolare ignora un
--  consiglio, resta silenziato per un periodo prima di poter ricomparire
--  (e solo se il numero dietro resta sopra soglia). Senza questa tabella
--  un motore a regole ripeterebbe lo stesso avviso ogni giorno.
--
--  identificativo è stabile per tipo di consiglio (es. 'resa_bassa:<id
--  servizio>'), non lega ai valori: la decisione se un consiglio è "lo
--  stesso di ieri" o "un consiglio nuovo" resta a lib/consigli.ts.
-- =====================================================================

create table consigli_ignorati (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  identificativo text not null,
  ignorato_fino  timestamptz not null,
  created_at     timestamptz not null default now(),
  unique (tenant_id, identificativo)
);

create index consigli_ignorati_tenant_idx on consigli_ignorati (tenant_id);

alter table consigli_ignorati enable row level security;

-- Solo il titolare: i consigli sono una vista di gestione, come le metriche.
create policy consigli_ignorati_owner_all on consigli_ignorati
  for all to authenticated
  using (tenant_id in (select my_owner_tenant_ids()))
  with check (tenant_id in (select my_owner_tenant_ids()));
