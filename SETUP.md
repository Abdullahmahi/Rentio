# Rentio — getting it running

## 1. Database (one paste)

Open **Supabase → SQL Editor → New query**, paste all of
[`supabase/setup.sql`](supabase/setup.sql), and Run.

That file is **generated** — `bun run db:setup` concatenates every migration
in `supabase/migrations/` plus `supabase/seed.sql`. Edit those, not `setup.sql`.

It creates the schema, row level security, the portal views, the Texas
compliance migrations and El Paso demo data, in that order. Verified end to
end from an empty PostgreSQL 17 database: 3 properties, 40 units, 31 leases,
86 invoices, 73 payments, 15 work orders, and 39/39 RLS assertions passing.

> The **last section is demo data** and begins with `TRUNCATE`. Delete it
> before running this anywhere but a demo or staging project.

## 2. Demo logins

```sh
bun run db:demo-logins
```

This goes through the Supabase Admin API and prints a real sign-in check per
account, so a row that exists but cannot log in shows up immediately.

Password for every account below: `Rentio2026!`

| Role | Email |
| --- | --- |
| Admin | `admin@suncitypm.com` |
| Property manager | `manager@suncitypm.com` |
| Admin (legacy alias) | `admin@rentio.mx` |
| Tenant | `brandon.nguyen@example.com` |
| Tenant | `lucia.beltran@example.com` |
| Tenant | `rocio.guadalupe@example.com` |

**The tenant logins change whenever the demo data is reseeded**, because they
are derived from whichever tenants the seed created. `db:demo-logins` prints
the current set at the end of every run — trust that over this table.

Reseeding changes which tenants exist, so their logins change with them.
`db:demo-logins` removes any demo login it did not just create — otherwise
the old accounts keep working, land with no profile, and show a blank
portal. It only ever touches the demo domains.

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

`DATABASE_URL` is used by `bun run db:test`, and by `bun run db:types` when it
can reach port 5432. If the database password is not available, set
`SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` instead and `db:types`
reads the catalog through the Management API.

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
  send-tenant-invite send-staff-invite generate-deposit-disposition \
  generate-notice-to-vacate tenant-self-enroll submit-access-request \
  --project-ref duttovdfuyywsvczkyur
```

> Every import in `supabase/functions/**` must be a fully-qualified
> `npm:` or `jsr:` specifier. The remote bundler does **not** read
> `supabase/functions/deno.json` — that file exists only so `deno check`
> works locally. Bare specifiers typecheck fine and then fail the deploy.

**Status** — all four deployed and exercised against the live project.

| | |
| --- | --- |
| `generate-invoice-pdf` | Working. Letterhead with address, tenant and unit, line items, Total/Pagado/Saldo, and a "How to pay" block built from whichever payment instructions are filled in. A tenant renders their own receipt and gets `not found` for anyone else's. |
| `generate-deposit-disposition` | Working. The §92.104 itemized disposition, in the tenant's language. Verified against the live project with and without deductions. |
| `generate-notice-to-vacate` | Working. The §24.005 notice, in the tenant's language. Verified against the live project. |
| `send-invoice-email` | Working. Delivered a real email with the PDF attached, subject `Recibo de renta — Agosto de 2026 — Unidad 102`. |
| `send-tenant-invite` / `send-staff-invite` | Working. Both mint the link with `generateLink` and deliver through Resend. Role guards verified — a tenant is refused by all three. |
| `tenant-self-enroll` / `submit-access-request` | Working. The only two endpoints an anonymous caller can reach; both return an identical body and timing whatever happens. |

> **Never use `inviteUserByEmail`.** It sends through Supabase's built-in
> SMTP, which is rate limited to a few messages an hour and is documented as
> not for production. Once it starts returning `over_email_send_rate_limit`
> the account is not created either, so invites fail silently after the first
> couple. Mint the link with `auth.admin.generateLink` and send it with
> `sendEmail` (Resend) instead — every invite path here does.
>
> Both invite functions create the profile **before** sending, and return
> `{ invited: true, emailed: false }` rather than throwing when delivery
> fails. Otherwise a send failure leaves a login with no profile, which
> authenticates and then lands on a blank portal.

### Before real tenants receive anything

1. **Verify a sending domain** at [resend.com/domains](https://resend.com/domains), then:
   ```sh
   npx supabase secrets set "RESEND_FROM=Rentio <no-reply@your-domain.com>" \
     --project-ref duttovdfuyywsvczkyur
   ```
   Until then Resend only delivers to the account owner's own address, and
   every other recipient is rejected with a 403.

2. **Change `SITE_URL`.** It is `http://localhost:5199`, and it is the redirect
   in invitation emails — a real tenant would get a set-password link pointing
   at their own machine.
   ```sh
   npx supabase secrets set SITE_URL=https://your-app.com --project-ref duttovdfuyywsvczkyur
   ```

## Checks

```sh
bun test                 # 51 tests: invoicing, allocation, import, i18n parity,
                         # dates/timezone, Texas late fees, deposits, repairs
bun run build
bunx tsc --noEmit
bunx eslint .
bun run db:setup         # regenerate setup.sql after a migration
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql   # 39 cross-tenant assertions
```

`supabase/tests/rls_test.sql` rolls itself back, so it is safe against staging.

## Texas compliance

The app enforces four things the client can be fined or sued over. All of it
is a build specification, not legal advice — the client's attorney should
review the generated notice and disposition templates before either is used
with a real tenant.

| Rule | Where it lives |
| --- | --- |
| §92.019 — no late fee until rent is unpaid at the end of the second full day; 12% / 10% presumed-reasonable cap | `src/lib/late-fee.ts`, a database check constraint on `leases.grace_days` |
| §92.103–92.109 — 30 days to return a deposit from the forwarding address, with an itemized list | `src/lib/deposit.ts`, `leases.deposit_due_date` (generated), `generate-deposit-disposition` |
| §92.052, §92.056 — 7 days presumed reasonable to repair after written notice | `src/lib/texas.ts`, `work_orders.written_notice_at` (set by trigger for portal orders) |
| §24.005, §92.156 — notice to vacate, rekey within 7 days of possession | `src/lib/texas.ts`, `lease_notices`, `unit_turnover_checklist` |

### Timezone

El Paso is **Mountain Time** — the only major Texas city that is. Every date
comparison goes through `src/lib/format.ts`, which answers "today" in
`America/Denver` and treats a `date` column as a calendar date rather than a
UTC instant. Do not reintroduce `new Date().toISOString().slice(0, 10)`; from
6pm local until midnight it returns tomorrow.

## Social sign-in

No OAuth provider is enabled yet — `/auth/v1/settings` reports `google`,
`apple` and `facebook` all false. The sign-in page asks that endpoint at
runtime and renders a provider button only for what is actually switched on,
so **no redeploy is needed** once you enable one.

To turn on Google: create an OAuth client in Google Cloud, add
`https://duttovdfuyywsvczkyur.supabase.co/auth/v1/callback` as an authorised
redirect URI, then paste the client ID and secret into Supabase →
Authentication → Providers → Google. The button appears on next page load.

Apple needs an Apple Developer Program membership ($99/year); Facebook needs
a Meta app and a public privacy policy URL. `src/lib/auth-providers.ts` takes
either by adding to `SUPPORTED_PROVIDERS` and a mark to `oauth-buttons.tsx`.

> Someone signing in with a social account that has no `profiles` row is
> signed straight back out with "We couldn't find an account for that
> address" and pointed at `/request-access`. Without that they would loop
> between the route guard and the shell forever.
