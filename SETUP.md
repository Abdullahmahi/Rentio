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

```sh
bun run db:demo-logins
```

This goes through the Supabase Admin API and prints a real sign-in check per
account, so a row that exists but cannot log in shows up immediately.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@rentio.mx` | `Rentio2026!` |
| Property manager | `gerente@rentio.mx` | `Rentio2026!` |
| Tenant | the first three primary tenants from the seed | `Rentio2026!` |

Change these before anyone outside the team sees the app.

> **Never create auth users with SQL.** GoTrue owns `auth.users` and scans
> several columns into non-nullable Go types. A hand-inserted row makes *every*
> sign-in on the project fail with "Database error querying schema", and the
> Admin API then cannot delete it either, because it loads the user first. If
> you hit that, run [`supabase/seed_auth.sql`](supabase/seed_auth.sql) — which
> now only deletes those rows — and then `bun run db:demo-logins`.

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

## 5. Edge functions (PDFs and email)

Deployed to project `duttovdfuyywsvczkyur`. To redeploy after a change:

```sh
export SUPABASE_ACCESS_TOKEN=sbp_...
npx supabase functions deploy generate-invoice-pdf send-invoice-email \
  send-tenant-invite send-staff-invite --project-ref duttovdfuyywsvczkyur
```

> Every import in `supabase/functions/**` must be a fully-qualified
> `npm:` or `jsr:` specifier. The remote bundler does **not** read
> `supabase/functions/deno.json` — that file exists only so `deno check`
> works locally. Bare specifiers typecheck fine and then fail the deploy.

**Status** — all four deployed and exercised against the live project.

| | |
| --- | --- |
| `generate-invoice-pdf` | Working. Verified on REC-00050: letterhead with address, tenant and unit, line items, Total/Pagado/Saldo, bank details, CFDI disclaimer. A tenant renders their own receipt and gets `not found` for anyone else's. |
| `send-invoice-email` | Working. Delivered a real email with the PDF attached, subject `Recibo de renta — Agosto de 2026 — Unidad 102`. |
| `send-tenant-invite` / `send-staff-invite` | Deployed. Role guards verified — a tenant is refused by all three. |

### Before real tenants receive anything

1. **Verify a sending domain** at [resend.com/domains](https://resend.com/domains), then:
   ```sh
   npx supabase secrets set "RESEND_FROM=Rentio <no-reply@tu-dominio.mx>" \
     --project-ref duttovdfuyywsvczkyur
   ```
   Until then Resend only delivers to the account owner's own address, and
   every other recipient is rejected with a 403.

2. **Change `SITE_URL`.** It is `http://localhost:5199`, and it is the redirect
   in invitation emails — a real tenant would get a set-password link pointing
   at their own machine.
   ```sh
   npx supabase secrets set SITE_URL=https://tu-app.com --project-ref duttovdfuyywsvczkyur
   ```

## Checks

```sh
bun test                 # 25 tests: invoicing, allocation, import, i18n parity
bun run build
bunx tsc --noEmit
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql   # 32 cross-tenant assertions
```

`supabase/tests/rls_test.sql` rolls itself back, so it is safe against staging.
