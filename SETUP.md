# Rentio — getting it running

```
Browser ──Clerk session──▶ App (TanStack Start, Node) ──60s JWT──▶ PostgREST ──RLS──▶ Postgres 17
                              │  /rest/v1/*  data API proxy           (private)          (private)
                              │  /api/fn/*   PDFs, invites, email
                              └  /api/storage, /api/files   files on a persistent volume
```

Clerk proves who someone is. The app server looks up their profile and calls
PostgREST with a short-lived JWT (`sub` = profile id, `org_id` = their
organization), so **Postgres row level security is still what decides access**,
exactly as it did on Supabase. Only the app is public; PostgREST and Postgres
live on the private Docker network.

## 1. Database

Fresh database: run [`supabase/setup.sql`](supabase/setup.sql) with `psql`.
It is **generated** — `bun run db:setup` concatenates every migration in
`supabase/migrations/` plus `supabase/seed.sql`. Edit those, not `setup.sql`.
On a plain Postgres, run `supabase/tests/local_shim.sql` first: the older
migrations still reference the Supabase `auth` and `storage` schemas.

> The **last section is demo data** and begins with `TRUNCATE`. Delete it
> before running this anywhere but a demo or staging database.

The Hetzner database (restored from the Supabase dump) only needs the two
newest migrations, in order, each as its own `psql -f` call:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261024001300_super_admin_role.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261024001400_self_hosted_multi_tenant.sql
psql "$DATABASE_URL" -c "alter role authenticator password '<PGRST password>'"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
```

Both are safe to re-run. The second puts every existing row into one
organization named after `settings.company_name`, links profiles to their old
Supabase email (from `auth.users`, if the restore kept it), and adds the
org-isolation policies. Rename the organization afterwards if needed:
`update organizations set name = '…', slug = '…';`

## 2. Logins (Clerk)

1. Create a Clerk application. Turn on **Email + password** and, if wanted,
   **Google** (Clerk → Configure → SSO connections; no code change needed —
   the sign-in card shows whatever is enabled).
2. Nobody needs to be created by hand. The first time someone signs in, the
   app links their Clerk login to a profile by a **Clerk-verified** email:
   - a profile staff invited, or one carried over from Supabase; or
   - exactly one tenant with that email who is on a lease (tenant self-enrolment).

   A login that matches neither is signed out with "we couldn't find an
   account" and pointed at `/request-access`.
3. To make someone PortfolioAI staff across every organization:
   `update profiles set role = 'super_admin', org_id = null where email = '…';`

Demo logins for a **development** Clerk instance (needs `POSTGREST_URL`
reachable from your machine):

```sh
bun run db:demo-logins
```

It prints the current set, password `Rentio2026!`. The tenant logins change
whenever the demo data is reseeded; trust that output over any doc.

## 3. Environment

Every variable, with what it is for, is in [`.env.example`](.env.example).
Locally they go in `.env.local` (git-ignored); in production, in Coolify.
Nothing secret is `VITE_`-prefixed: those are compiled into the browser bundle.

## 4. Run it locally

```sh
bun install
# Postgres with the migrations applied, then PostgREST next to it:
docker run --rm -p 3001:3000 \
  -e PGRST_DB_URI="postgres://authenticator:<password>@host.docker.internal:5432/rentio" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$POSTGREST_JWT_SECRET" postgrest/postgrest:v12.2.12
bun run dev
```

## 5. Deploy (Hetzner + Coolify)

Three resources in one Coolify project, all on the same Docker network:

| Resource | How | Public? |
| --- | --- | --- |
| `rentio-db` | Postgres 17 (already running) | **No** |
| `rentio-postgrest` | Docker Image `postgrest/postgrest:v12.2.12`, port 3000. Env: `PGRST_DB_URI=postgres://authenticator:<pw>@<rentio-db internal host>:5432/rentio`, `PGRST_DB_SCHEMAS=public`, `PGRST_DB_ANON_ROLE=anon`, `PGRST_JWT_SECRET=<same value as the app's POSTGREST_JWT_SECRET>` | **No** — no domain, no published port |
| `rentio-app` | Git repo `Abdullahmahi/Rentio`, branch `main`, build pack **Dockerfile**, port **3000**. Env from `.env.example`; mark `VITE_CLERK_PUBLISHABLE_KEY` as a build variable. Persistent storage: mount a volume at `/data/storage` and set `STORAGE_DIR=/data/storage` | Yes — set the FQDN, Let's Encrypt is automatic |

Then:

- **DNS:** A record for the app domain → `5.161.214.240`. Set `SITE_URL` to
  that `https://` URL (invite emails link to it) and add the domain in Clerk.
- **Email:** verify a sending domain at [resend.com/domains](https://resend.com/domains)
  and set `RESEND_FROM`. Until then Resend only delivers to the account owner.
- **Backups:** `rentio-db` → Backups → daily, to S3-compatible storage off this
  server. Back up the `/data/storage` volume too — uploaded leases, receipts
  and photos live there. Restore once into a scratch database to prove it works.
- **Firewall:** allow 22, 80, 443 only. Reach Coolify's 8000 over an SSH tunnel.
- **Files:** the old Supabase Storage files are gone with the project (demo data only), so `/data/storage` starts empty. Re-upload anything needed through the app.

## Checks

```sh
bun test                 # 52 tests: invoicing, allocation, import, i18n parity,
                         # dates/timezone, Texas late fees, deposits, repairs
bun run build
bunx tsc --noEmit
bunx eslint .
bun run db:setup         # regenerate setup.sql after a migration
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql   # role + cross-organization assertions
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
| §92.103–92.109 — 30 days to return a deposit from the forwarding address, with an itemized list | `src/lib/deposit.ts`, `leases.deposit_due_date` (generated), `/api/fn/generate-deposit-disposition` |
| §92.052, §92.056 — 7 days presumed reasonable to repair after written notice | `src/lib/texas.ts`, `work_orders.written_notice_at` (set by trigger for portal orders) |
| §24.005, §92.156 — notice to vacate, rekey within 7 days of possession | `src/lib/texas.ts`, `lease_notices`, `unit_turnover_checklist` |

### Timezone

El Paso is **Mountain Time** — the only major Texas city that is. Every date
comparison goes through `src/lib/format.ts`, which answers "today" in
`America/Denver` and treats a `date` column as a calendar date rather than a
UTC instant. Do not reintroduce `new Date().toISOString().slice(0, 10)`; from
6pm local until midnight it returns tomorrow.

