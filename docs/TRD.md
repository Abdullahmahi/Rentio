# TRD: Rentio

| | |
|---|---|
| **Version** | 1.0 · 2026-10-21 |
| **Describes** | The code as it is on `main` (`4fe1b62`), plus the target architecture of the next phase |
| **Product** | [`PRD.md`](PRD.md) · **Next-phase plan:** [`superpowers/specs/2026-10-10-multi-tenant-platform-design.md`](superpowers/specs/2026-10-10-multi-tenant-platform-design.md) |

If this doc and the code disagree, the code is the truth. Fix this doc in
the same change and say so in `reports.md`.

---

## 1. Stack

| Layer | Choice |
|---|---|
| App framework | **TanStack Start** (file routes in `src/routes/`, `routeTree.gen.ts` generated) · React 19 · TypeScript · Vite 8 · Nitro (`node-server`; the Dockerfile sets `NITRO_PRESET`) |
| UI | Tailwind CSS 4 (configured in CSS, no `tailwind.config`) · shadcn/ui on Radix · lucide icons · Recharts · sonner toasts · cmdk (⌘K) |
| Data in the browser | `@tanstack/react-query` over `db` (`@supabase/postgrest-js`, `src/lib/db.ts`) — same query builder as before, pointed at our own PostgREST |
| Backend | **Self-hosted**: Postgres 17 + PostgREST v12 (both private), RLS · app server routes under `/api/*` (Node) · **Clerk** for auth · files on a persistent volume |
| Email | Resend REST API from server routes (`src/lib/server/email.ts`) |
| PDF | `pdf-lib` in server routes |
| i18n | i18next + react-i18next, `en` and `es-MX` |
| Tooling | **bun** (install, test, scripts) · ESLint 9 · Prettier |
| Hosting | **Hetzner + Coolify** (`Dockerfile`; app, PostgREST and Postgres on one Docker network). No CI |

## 2. Repo layout

```
src/
  routes/            file routes: / (marketing), auth pages, /app/* (staff), /portal/* (tenant)
  components/ui/     shadcn primitives. NEVER hand-edited (design rule 6)
  components/rentio/ app components: shells, data-table, lease-wizard, money-input, status, statutory-clock…
  components/marketing/  landing page (derived from Vetra, MIT; see NOTICE)
  lib/               domain logic + its tests (*.test.ts), queries, auth, supabase client
  locales/           en.json, es-MX.json (exact parity), marketing.en.json (English only)
  server.ts start.ts SSR entry (static 500 page) and middleware
supabase/
  migrations/        source of truth for the schema, applied in filename order
  functions/         8 edge functions + _shared/common.ts
  tests/rls_test.sql transactional RLS assertions
  audits/            read-only SQL reports (late fees)
  seed.sql           El Paso demo data · setup.sql GENERATED (migrations + seed)
scripts/             seed-demo-logins.ts, validate_palette.js
design-system/       rentio/MASTER.md (read before UI work) + per-page overrides
docs/                PRD, TRD, workflow docs, superpowers/specs/
```

## 3. Architecture today

```
Browser (React, react-query) ──Clerk token──▶ App server ──60s JWT (sub=profile, org_id)──▶ PostgREST ──RLS──▶ Postgres
                                                 │  /rest/v1/*   proxy to PostgREST (src/routes/rest.v1.$.ts)
                                                 │  /api/me      profile, links a new Clerk login on first sign-in
                                                 │  /api/fn/*    PDFs, invites, email, access requests
                                                 └  /api/storage/*, /api/files/*   files on STORAGE_DIR
```

- **Identity vs access.** Clerk verifies the login (`clerkMiddleware` in `src/start.ts`, `auth()` in `src/lib/server/session.ts`). The server maps it to a profile and signs a 60-second HS256 JWT for PostgREST with the shared `POSTGREST_JWT_SECRET`. That token never reaches the browser. **RLS is still the real security boundary**; route guards are client-side (`require-role.tsx`).
- **Server code** lives in `src/lib/server/` and in route files' `server.handlers`. `session.db` acts as the caller (RLS on, the default); `serviceDb()` bypasses RLS and is only for what the caller cannot do themselves.
- **Business logic currently runs in the browser** as several separate writes with no transaction: invoice generation, payment allocation, invoice status recompute, invoice totals. This is a known risk (B-006, B-013). New money logic goes in SQL functions or triggers, not in components.
- One RPC is used, `next_invoice_number`.

## 4. Data model

All money is `numeric(12,2)`. Enum values are **Spanish internally**
(`borrador`, `pagado`, `pendiente`…) for historical reasons. They are API, so
don't rename them; translate at the UI.

| Table | Purpose / notable columns |
|---|---|
| `profiles` | PK = `auth.users.id`; `role` (`admin`·`manager`·`tenant`), `tenant_id`, `locale` (null = surface default) |
| `properties` | US address (`state` USPS check, `postal_code` ZIP check), `units_in_structure` (late-fee cap) |
| `units` | unique `(property_id, unit_number)`; `status` enum; `sqm` **holds square feet** |
| `tenants` | contact fields; `email` **not unique** (B-007); self-update limited by the `tenants_restrict_self_update` trigger |
| `leases` | rent, `rent_due_day` 1–31, `grace_days ≥ 2` (check, §92.019), `late_fee_type` fixed/percent, `late_fee_over_cap_ack`; deposit clock: `forwarding_address_received_at`, generated `deposit_due_date` (+30), `deposit_itemization` jsonb. Legacy `deposit_status`/`deposit_refunded`/`deposit_retained` are still written as free text |
| `lease_tenants` | `role` primary / co_tenant / guarantor |
| `parking_spaces` | per property, optional `lease_id` |
| `invoices` | **unique `(lease_id, period_month)`**, unique `invoice_number`; `total` is synced by the client |
| `invoice_lines` | `category` incl. `recargo` (late fee) and `nsf_fee`; guarded by `enforce_late_fee_rules()` |
| `payments` | `method` (`ach`·`zelle`·`check`·`money_order`·`cash`·`card`·`other`), `status` (`pendiente`·`confirmado`·`cancelado`), `reported_by_tenant`, `receipt_url`, `void_reason`; `amount > 0` |
| `payment_allocations` | payment → invoice amounts |
| `utility_charges` | unique `(unit_id, type, period_month)`; **no longer pulled into receipts** |
| `work_orders` | `folio` `OT-#####`, `source` (incl. `whatsapp` for later), `affects_health_safety`, `written_notice_at` (set by trigger for portal orders) |
| `work_order_notes` | `is_internal` defaults **true** |
| `work_order_photos`, `documents` | storage paths; `documents` is polymorphic `owner_type`/`owner_id` |
| `lease_notices` | §24.005 notices (`notice_type`, `notice_delivery`) |
| `unit_turnover_checklist` | unique `(lease_id, item_key)`; rekey item §92.156 |
| `access_requests` | anonymous requests, `status` pending/approved/declined |
| `expenses` | per unit, staff only, `amount > 0` |
| `activity_log` | audit trail. Currently staff-editable, and `actor_id` comes from the client (S-008) |
| `settings` | **singleton** row: company, payment instructions (Zelle handle, check payee/mailing, drop-off, office hours), `invoice_prefix`, defaults, `nsf_fee` |

**Views**

| View | Security | Returns |
|---|---|---|
| `lease_balances` | invoker | invoiced (not cancelled) − confirmed paid, oldest overdue date |
| `invoice_balances` | invoker | paid and balance per invoice |
| `deposit_obligations` | invoker | deposit clock per lease (unused by the app) |
| `my_lease_details` | **definer** | unit + property address for staff or the caller's leases. Returns nothing to the service role (B-003) |
| `public_settings` | **definer** | company and payment instructions, no bank numbers. Readable by anon (S-010) |

**Functions and triggers:** `set_updated_at` (every table), `next_invoice_number()`,
`next_work_order_folio()`, `enforce_late_fee_rules()` (BEFORE INSERT/UPDATE on
`invoice_lines`, `recargo` only: date ≥ due + max(grace,2) + 1, one per
invoice), `work_orders_set_written_notice`, `turnover_set_completed_at`,
`tenants_restrict_self_update`.

## 5. Security model

- **Roles** live in `profiles.role`. Helpers (all `stable security definer`): `is_staff()`, `is_admin()`, `my_tenant_id()`, `my_lease_ids()`.
- **Policy pattern:**
  - Loop-generated staff policies cover properties, units, utility_charges, settings and activity_log: staff can select, insert and update; only admins delete.
  - Everything else is hand-written. Select is `is_staff() or lease_id in my_lease_ids()`; writes are staff; delete is admin (staff on child tables).
- **Tenants can write only:**
  - payments with `status='pendiente'` and `reported_by_tenant=true`
  - work orders with `source='portal'`
  - work-order photos
  - their own tenant row (contact fields)
  - their own profile, where the column restriction is missing (**S-001**)
- **Only an admin can set** `payments.status='cancelado'`.
- **Storage:**
  - Five private buckets: `contracts`, `tenant-docs`, `payment-receipts`, `work-order-photos`, `company`.
  - Paths are `<owner_id>/<file>`; `uploadFile` in `src/lib/storage.ts` builds them.
  - Files are served by signed URL only.
  - Tenants read by folder ownership, but can read **all of `company`** (S-004).
- **Organizations.** Every table carries `org_id` (default `current_org_id()` from the JWT; child tables re-derive it from their parent by the `org_from_parent` trigger and refuse a mismatch). One RESTRICTIVE `org_isolation` policy per table ANDs with every policy above. `super_admin` (`org_id` null) reads across orgs. `my_lease_details` and `public_settings` are security-definer views and filter by org themselves.
- **Role changes:** only an admin (or the service connection) can set `role`, `org_id`, `tenant_id`, `email` or `clerk_user_id` on a profile, or insert a non-tenant profile (`profiles_restrict_role_changes`). This closes **S-001**.
- **Storage** is now `src/lib/server/storage.ts`: `<STORAGE_DIR>/<org_id>/<bucket>/<path>`, org from the session, signed links verified by HMAC. `mayAccess()` restates the old storage policies.
- **Anonymous surface:** only `/api/fn/submit-access-request` (always `{ok:true}`, work after the response) and Clerk sign-up. A sign-up only opens a portal if its Clerk-verified email matches an invited profile or exactly one tenant on a lease.

Open security findings are in `docs/security.md` (gitignored).

## 6. Server routes (were Supabase Edge Functions)

All POST under `/api/fn/<name>`, called with `invokeFn(name, { body })` from `src/lib/db.ts` (same `{ data, error }` shape as `supabase.functions.invoke`).

| Route | Caller | Does |
|---|---|---|
| `generate-invoice-pdf` | any signed-in user (RLS decides) | Receipt PDF (Spanish-only today, A4; B-009) via `src/lib/server/invoice-pdf.ts`, stored at `contracts/<lease>/`, returns a 10-min signed URL |
| `send-invoice-email` | staff | Same renderer, emails it via Resend, `borrador → enviado` |
| `generate-notice-to-vacate` | staff | §24.005 PDF in the tenant's locale, stored on `lease_notices.document_url` |
| `generate-deposit-disposition` | staff | §92.104 itemized PDF from `deposit_itemization` |
| `send-tenant-invite` | staff | Profile with the email (no login yet) + bilingual email linking to `/activate?email=`; returns `{invited, emailed}` |
| `send-staff-invite` | admin | Same, for admin/manager |
| `submit-access-request` | anon | Stores a `pending` access request (org by `org` slug, or the only org) |

`tenant-self-enroll` is gone: Clerk sign-up plus the email match in `session.ts` does the same job.
Secrets: `CLERK_SECRET_KEY`, `POSTGREST_JWT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `SITE_URL` (see `.env.example`).

## 7. Frontend

- **Shells:** `app-shell.tsx` (staff: sidebar from `nav-items.tsx`, header title derived from the URL, ⌘K palette with the same nine items) and `portal-shell.tsx` (tenant: two tabs plus a profile icon).
- **Guards:**
  - `/app` → `<RequireRole allow="staff">`
  - `/portal` → `allow="tenant"`
  - `<AdminOnly>` wraps admin controls inside pages.
  - `homeFor(role)` sends tenants to `/portal` and staff to `/app`.
- **Data:**
  - `usePortfolio()` loads 7 whole tables and joins them in memory. It carries a `ponytail:` ceiling note: fine to a few thousand units.
  - `useMyPortal()` is the tenant's data via RLS.
  - `useToastMutation` gives every mutation a toast and invalidates its keys.
  - `logActivity` is a fire-and-forget audit insert.
- **i18n:**
  - All resources are bundled up front.
  - Language is resolved in this order: `profiles.locale` → `localStorage['rentio-language']` → surface default (portal `es-MX`, everything else `en`). `<html lang>` is chosen by path on the server.
  - `i18n.test.ts` enforces two-way key parity, no empty values, matching `{{placeholders}}`, and that every literal `t("…")` key exists.
- **Design:** read `design-system/rentio/MASTER.md`.
  - Tokens are CSS variables in `styles.css`, written as `oklch(from #hex …)`. Dark mode is the `.dark` class.
  - Inter for body and numbers (`numeric` utility); Source Serif 4 on h1–h3 only.
  - Contrast is measured with `scripts/validate_palette.js`, never eyeballed.

## 8. Invariants (break one and the change is wrong)

1. **"Today" means today in `America/Denver`.** Use `todayIso()` / `format.ts`. Never `new Date().toISOString().slice(0,10)`, which returns tomorrow from 6pm local. In SQL, use `(now() at time zone 'America/Denver')::date`, not `current_date` (B-004).
2. **A `date` column is a calendar date**, not a UTC instant. `formatDate` prints it as-is.
3. **Money is never a float you sum and trust.** Round to cents at every boundary. Totals belong in the database.
4. **RLS is the boundary.** Every new table gets RLS and policies in the same migration, plus RLS-suite assertions. Hiding a button is not security.
5. **Payments and invoices are never hard-deleted.** Void with a reason. Every insert, confirm and void writes `activity_log`.
6. **Texas rules live in one place each:** `late-fee.ts` + `enforce_late_fee_rules()` (§92.019), `deposit.ts` + `deposit_due_date` (§92.103), `texas.ts` (§92.056 / §92.156 / §24.005). The UI and the database must agree.
7. **Never create auth users with SQL.** A hand-inserted `auth.users` row breaks every sign-in on the project. Use the Admin API (`seed-demo-logins.ts`).
8. **Never `inviteUserByEmail`.** Mint with `auth.admin.generateLink` and send through Resend. Create the profile before sending.
9. **Edge-function imports are `npm:` or `jsr:` only.** The remote bundler ignores `deno.json`.
10. **Locale parity is exact.** Every string goes in both locale files.
11. **Never hand-edit** `components/ui/`, `routeTree.gen.ts`, `database.types.ts` or `setup.sql`. They are generated or vendored.
12. **Hidden routes stay deployed.** Don't delete them and don't add them to the nav without the owner's say-so (PRD §4.2).
13. **Secrets** stay in `.env.local` (gitignored) or Supabase secrets. `.env.example` holds names only. The repo is public.

## 9. Workflows

| Task | Steps |
|---|---|
| Schema change | New file `supabase/migrations/<yyyymmddhhmmss>_<name>.sql` → `bun run db:types` → `bun run db:setup` → RLS assertions in `rls_test.sql` → `bun run db:test` |
| Edge function | Edit → `deno check` → `npx supabase functions deploy <name> --project-ref <ref>` (needs `SUPABASE_ACCESS_TOKEN`) |
| Demo data | `bun run db:demo-logins` (prints the current logins) |
| Ship | `docs/testing.md` gates → push `main` (= production) |

**Known environment gap:** `DATABASE_URL` points at the direct host
`db.<ref>.supabase.co`, which doesn't resolve from this machine because it is
IPv6-only. So `db:test` and `db:types` fail here. Use the Supabase **session
pooler** connection string (IPv4) in `.env.local`, or `db:types` through the
Management API (`SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN`).

## 10. Testing

- `bun test`: 52 tests in 8 files.
  - deposit (6), format (8), i18n (6), import (9), invoicing (8), late-fee (6), portfolio (5), texas (4).
  - The pure domain logic is covered; components and queries are not.
- `supabase/tests/rls_test.sql`: about 40 effective assertions, in a transaction that rolls back.
  - Covers tenant isolation, payment voiding, and the staff-only tables.
  - **Doesn't cover** storage policies, profile self-update, documents, parking, `deposit_obligations` or anonymous access.
- `supabase/audits/late_fee_audit.sql`: a read-only report of every late fee, with a verdict on its date and cap.
- Manual QA: `docs/testing.md`.

## 11. Target architecture: multi-tenant platform

The full spec is in `superpowers/specs/2026-10-10-multi-tenant-platform-design.md`.
**Tenancy now exists** (`20261024001400`, per `RENTIO_MIGRATION_SPEC.md`, which
won where the two specs conflicted: `super_admin` instead of a no-data
`platform` role, org from the JWT instead of `my_org_id()`, files under
`<org_id>/` on disk instead of in the path). Still to build: host → org,
branding, modules, the platform page and Stripe. The original deltas:

- **Tenancy:**
  - An `organizations` table.
  - `org_id not null` on every table, filled by the `set_org_id()` trigger from `my_org_id()`.
  - Every staff policy gets `and org_id = my_org_id()`.
  - `settings.singleton` becomes `unique(org_id)`.
  - Per-org `invoice_number` and `folio`.
- **Storage:** paths become `<org_id>/<owner_id>/<file>`, still built only in `uploadFile`. A new public `branding` bucket holds logos.
- **Host → org:**
  - `org_for_host(host)` is a security-definer function that returns branding only.
  - The root loader calls it server-side and emits a `--primary`/`--accent` override.
  - Modules filter `navGroups` and the `/app` guard.
- **Platform role:**
  - `user_role` gains `platform`, with `org_id null`, and sees no client data.
  - A new `/platform` page.
- **Stripe Connect Express (direct charges):**
  - `stripe-connect-onboard` (admin).
  - `stripe-checkout` (tenant, `userClient`): card, `us_bank_account`, `cashapp`.
  - `stripe-webhook` (signature-verified, idempotent on `stripe_payment_intent_id`).
- **`confirm_payment(payment_id)`** in SQL replaces browser allocation, and both staff and the webhook call it. This also closes B-013.
- **Rollout:** five phases, each shipped on its own. Every phase ends with `docs/audit.md`.
  1. Tenancy, policies, storage, RLS suite
  2. Org settings, theme, modules, host resolution
  3. Platform role and page, invites with `org_id`, email identity
  4. Stripe: onboard, Checkout, webhook, `confirm_payment`
  5. Move El Paso storage paths and add their domain

**Prerequisite before phase 1:** fix S-001/S-002. Phase 1 multiplies the
value of a role escalation, because one compromised account would expose a
whole organization.
