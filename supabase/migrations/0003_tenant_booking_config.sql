-- =====================================================================
--  0003_tenant_booking_config.sql
--
--  Configurazione di prenotazione per tenant (widget pubblico):
--   - booking_horizon_days: quanti giorni in avanti si può prenotare.
--   - min_lead_minutes: anticipo minimo rispetto a "adesso".
--
--  Sono letture pubbliche (la policy tenants_public_read già copre le
--  nuove colonne): servono al widget per costruire il calendario e a
--  /api/slots per filtrare gli slot troppo vicini.
-- =====================================================================

alter table tenants
  add column booking_horizon_days int not null default 30
    check (booking_horizon_days between 1 and 365),
  add column min_lead_minutes int not null default 60
    check (min_lead_minutes >= 0);
