# Rentio — getting it running

## 1. Database (one paste)

Open **Supabase → SQL Editor → New query**, paste all of
[`supabase/setup.sql`](supabase/setup.sql), and Run.

It creates the schema, row level security, the tenant-portal view, demo data
and demo logins, in that order. Verified end to end against PostgreSQL 17:
40 units, 30 leases, 86 invoices, 5 logins, and 32/32 RLS assertions passing.

> Sections 4 and 5 of that file are **demo data**. Section 4 starts with
> `TRUNCATE`, and section 5 creates accounts with a known password. Delete both
> sections before running this anywhere but a demo or staging project.

## 2. Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@rentio.mx` | `Rentio2026!` |
| Property manager | `gerente@rentio.mx` | `Rentio2026!` |
| Tenant | `maria.fernanda@example.mx` | `Rentio2026!` |
| Tenant | `juan.carlos@example.mx` | `Rentio2026!` |
| Tenant | `ana.sofia@example.mx` | `Rentio2026!` |

Change these before anyone outside the team sees the app.

## 3. Environment

`.env.local` (git-ignored) needs:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

`DATABASE_URL` is only used by `bun run db:types` and `bun run db:test`.

## 4. Run it

```sh
bun install
bun run dev
```

## 5. Edge functions (optional — PDFs and email)

```sh
supabase functions deploy generate-invoice-pdf send-invoice-email \
  send-tenant-invite send-staff-invite
supabase secrets set RESEND_API_KEY=re_xxx \
  RESEND_FROM="Rentio <no-reply@tu-dominio.mx>" SITE_URL=https://tu-app.com
```

Until these are deployed, "Descargar PDF" and the invite buttons report a clear
error; everything else works. Sending a receipt still marks it sent and warns,
so the monthly cycle is never blocked on the mail provider.

## Checks

```sh
bun test                 # 25 tests: invoicing, allocation, import, i18n parity
bun run build
bunx tsc --noEmit
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql   # 32 cross-tenant assertions
```

`supabase/tests/rls_test.sql` rolls itself back, so it is safe against staging.
