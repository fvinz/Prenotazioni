# Prenotazioni

Sistema di prenotazioni multi-tenant per attività su appuntamento
(parrucchieri, estetiste, barber). Contesto e decisioni di dominio: vedi
[`CLAUDE.md`](./CLAUDE.md).

## Stack

Next.js (App Router) + TypeScript, Supabase (Postgres, Auth, RLS), Luxon,
Vitest, Tailwind.

## Setup

```bash
./scripts/setup.sh        # oppure: npm install
cp .env.local.example .env.local   # poi valorizza le variabili dal dashboard Supabase
```

## Comandi

```bash
npm run dev     # server di sviluppo (http://localhost:3000)
npm test        # test (vitest run)
npm run build   # build di produzione
```

## Migration Supabase

Le migration sono in `supabase/migrations/`, da applicare in ordine
(`0001`, `0002`) sul progetto Supabase: via SQL Editor del dashboard,
oppure con la CLI:

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push
```

## API

`GET /api/slots?tenantSlug=...&operatorId=...&serviceId=...&date=YYYY-MM-DD`
restituisce gli slot liberi (`{ slots: [{ start, label }] }`) calcolati da
`lib/slots.ts` (logica pura, testata) sui dati letti da Supabase.
