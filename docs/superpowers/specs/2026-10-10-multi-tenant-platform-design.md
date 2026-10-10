# Multi-tenant platform with Stripe Connect — design

**Date:** 2026-10-10
**Status:** approved in conversation, awaiting written review
**Scope:** turn Rentio from one deploy per landlord into one shared platform that
property management companies are onboarded onto by our team, with per-company
branding, module toggles, a tenant-portal domain, and online rent collection.

## 1. Goals and non-goals

Goals

- A property management company ("organization") can be created by our team and
  start onboarding its staff and tenants the same day.
- Customization is configuration only: logo, two colors, which modules are on,
  and the tenant portal domain. No client-specific code, ever.
- Tenants pay rent online by card, ACH, or Cash App Pay. Money lands in the
  organization's own bank account.
- Data isolation between organizations is enforced by the database, not the UI,
  and is covered by the existing row-security suite.
- The existing El Paso client moves onto the platform as organization one with
  no change in what their users see.

Non-goals (v1)

- Self-serve signup, in-app billing of our clients, trial logic. We invoice
  clients outside the product.
- Zelle and PayPal. Cash, check, and money order keep the existing self-report
  and staff-confirm flow.
- Convenience fees charged to tenants. State-law questions; the landlord
  absorbs processing fees.
- Per-client sending domains for email. All mail goes from our verified domain
  with the organization's name in the from-name.
- Partial refunds and dispute handling inside the app. Both happen in the
  organization's Stripe dashboard; the webhook only mirrors a full refund.
- A platform admin view into client data. Our team gets invited as that
  client's admin when they need to look inside.
- Making Texas compliance optional. Every client is in Texas today. It becomes
  a module when the first non-Texas client appears.

## 2. Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Hosting | One codebase, one Vercel project, one Supabase project, one database | Payments want one webhook, one set of secrets, one reconciliation path. Twenty copies of payment code is the thing we least want. |
| Isolation | `org_id` on every table, filled by trigger, checked by every staff policy | No join in any policy; mechanical to audit; the existing loop-generated policies take the clause in one place. |
| Hierarchy | Two levels: platform → organization → tenants | Confirmed with the owner. No reseller tier. |
| Who edits what | Client admin: logo, company details, payment instructions, Stripe. Platform: modules, domain, slug. | Cosmetics are the client's; anything that touches infrastructure or scope is ours. |
| Payments | Stripe Connect, Express accounts, direct charges | Organization is merchant of record, owns disputes and 1099-K. Express gives Stripe-hosted onboarding and a light dashboard. |
| Methods | `card`, `us_bank_account`, `cashapp` via one Checkout Session | One integration covers all three; Cash App Pay needs no extra onboarding on Connect for US accounts. |
| Platform fee | `application_fee_amount` wired, set to 0 | The field costs nothing now and avoids a migration later. |
| Portal hosts | Every organization gets `<slug>.<platform-domain>` automatically; a custom domain is optional on top | One wildcard DNS record and one wildcard domain on Vercel give every client a portal URL on day one. |
| Auth | One Supabase auth for the platform | Consequence: an email belongs to one account platform-wide. Accepted. |

## 3. Data model

### 3.1 `organizations`

```sql
create table public.organizations (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name                     text not null,
  portal_domain            text unique,              -- optional custom host
  logo_path                text,                     -- path in the public `branding` bucket
  primary_color            text,                     -- hex, e.g. '#174a3c'
  accent_color             text,                     -- hex
  modules                  text[] not null default '{}',
  stripe_account_id        text unique,
  stripe_charges_enabled   boolean not null default false,
  stripe_details_submitted boolean not null default false,
  platform_fee_bps         int not null default 0 check (platform_fee_bps between 0 and 1000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);
```

Module keys: `properties`, `units`, `tenants`, `contracts`, `payments`,
`online_payments`, `receipts`, `expenses`, `utilities`, `parking`, `maintenance`,
`reports`, `import`, `access_requests`. The dashboard and settings are always on.

### 3.2 `org_id` everywhere

Every table below gets `org_id uuid not null references public.organizations (id) on delete restrict`
plus an index on `(org_id)`:

properties, units, tenants, leases, parking_spaces, lease_tenants, invoices,
invoice_lines, payments, payment_allocations, utility_charges, work_orders,
work_order_notes, work_order_photos, documents, activity_log, settings,
lease_notices, unit_turnover_checklist, access_requests, expenses.

`profiles.org_id` is nullable and constrained: `check ((role = 'platform') = (org_id is null))`.

Child tables carry `org_id` too (denormalized) so no policy ever joins.

### 3.3 Helpers and trigger

```sql
create function public.my_org_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create function public.set_org_id() returns trigger language plpgsql as $$
begin
  if new.org_id is null then new.org_id := public.my_org_id(); end if;
  if new.org_id is null then
    raise exception 'org_id is required' using errcode = '23502';
  end if;
  return new;
end $$;
```

The trigger runs `before insert` on every table in 3.2 except `profiles`. User
inserts need no code change. Service-role inserts (edge functions) must pass
`org_id` or they fail loudly; an orphan row is never created.

### 3.4 Uniqueness that was global

- `invoices.invoice_number` → `unique (org_id, invoice_number)`
- `work_orders.folio` → `unique (org_id, folio)`
- `settings.singleton` → dropped; `settings.org_id` becomes `unique`
- `next_invoice_number()` and `next_work_order_folio()` count within
  `my_org_id()` and read the prefix from that organization's settings row.

### 3.5 Payments columns

- `payment_method` enum gains `cash_app`.
- `payments.stripe_payment_intent_id text unique`
- `payments.stripe_checkout_session_id text`

## 4. Row-level security

Rule: every staff clause becomes `public.is_staff() and org_id = public.my_org_id()`.
Tenant clauses are unchanged; lease membership already isolates them.

- The two `do` loops that generate staff policies take the clause once.
- Hand-written staff policies (profiles, tenants, leases and children, work
  orders and children, documents, lease_notices, unit_turnover_checklist,
  access_requests, expenses) each gain the clause.
- `profiles`: staff see profiles in their own organization only.
- `organizations`: members read their own row; `platform` role reads and
  writes all rows; only `platform` may insert.
- Column guard on `organizations` (a trigger like `tenants_restrict_self_update`):
  a non-platform caller may change only `logo_path`, `primary_color`,
  `accent_color`, `name`. `slug`, `portal_domain`, `modules`, `platform_fee_bps`
  and the Stripe columns are platform-only or service-role-only.
- Owner-rights views (`security_invoker = false`): `public_settings` and
  `my_lease_details` add `org_id = public.my_org_id()` to their staff branch.
  Invoker views (`lease_balances`, `invoice_balances`, `deposit_obligations`)
  inherit the table policies and need nothing.
- `is_staff()` and `is_admin()` are unchanged. `platform` is neither.

### Storage

Path convention becomes `<org_id>/<owner_id>/<file>` in every private bucket.
`uploadFile` in `src/lib/storage.ts` is the only place that builds a path; it
prepends the caller's `org_id` from the auth context.

- `storage_staff_all`: `is_staff() and (storage.foldername(name))[1]::uuid = my_org_id()`
- tenant read and write policies: the owner id moves from index 1 to index 2
- New public bucket `branding`, paths `<org_id>/<file>`, world-readable,
  writable by that organization's staff. Logos move here because the sign-in
  page shows them before anyone is authenticated.
- `company` bucket keeps letterhead assets that are not public, same prefix rule.

## 5. Branding, modules, domain

### Host resolution

```sql
create function public.org_for_host(host text)
returns table (id uuid, slug text, name text, logo_path text, primary_color text, accent_color text)
language sql stable security definer set search_path = public as $$
  select id, slug, name, logo_path, primary_color, accent_color
  from public.organizations
  where portal_domain = lower(host)
     or slug = split_part(lower(host), '.', 1)
  limit 1;
$$;
grant execute on function public.org_for_host to anon, authenticated;
```

Returns branding fields only. The root loader calls it with the request host
(server side on first paint, so colors and logo are right before hydration).
On the platform's own apex and `app.` hosts it returns nothing and the default
brand applies. Result is cached per host for the session.

### Theme

`src/styles.css` already defines `--primary` and `--accent` as
`oklch(from <hex> l c h)`. The root layout emits one `<style>` block overriding
those two variables, in both the light block and the dark block, when the
organization has colors. Nothing else in the token file changes. The settings
page shows the contrast ratio of the chosen primary against white and refuses
to save below 4.5:1, so a client cannot pick an unreadable button color.

### Modules

- `navGroups` in `nav-items.tsx` filters items by `org.modules`.
- The `/app` layout guard (where `require-role.tsx` runs today) maps each route prefix to a module key and redirects
  to `/app` when the module is off. Hidden routes stay deployed, as the current
  scope trim already does.
- The tenant portal checks `online_payments` for the pay button and
  `maintenance` for the request form; `receipts` and `contracts` links follow
  the same keys.

### Domain

- Vercel: add `*.<platform-domain>` once; add a custom domain per client in
  the dashboard when they want one. Client sets a CNAME.
- `portal_domain` is set by the platform page. `org_for_host` picks it up on
  next request.
- All links in outgoing email (invites, self-enroll, receipts) use
  `portalUrl(org)` = `https://<portal_domain>` or `https://<slug>.<platform-domain>`.
  The single `SITE_URL` secret becomes the platform domain and is only used for
  staff links. A shared helper in `supabase/functions/_shared/common.ts` owns this.

### Email identity

`RESEND_FROM` stays our verified domain. Every edge function sends as
`"<organization name> via <BRAND_NAME> <no-reply@platform-domain>"` and sets
`reply_to` to the organization's `settings.email` when present.

## 6. Platform role and page

- `user_role` enum gains `platform`. Platform users have `org_id null`.
- `/platform` route, guarded by `role === 'platform'`:
  - list organizations with slug, portal host, module count, Stripe status,
    staff count
  - create organization: name, slug, colors, modules
  - edit modules, portal domain, platform fee
  - "Invite first admin": calls `send-staff-invite` with `org_id`
- `send-staff-invite` accepts `org_id` when the caller is `platform`; an org
  admin's call keeps using the caller's own `org_id`.
- Platform users see nothing else. Every data policy requires
  `org_id = my_org_id()`, which is null for them, so the app shell redirects
  them straight to `/platform`.
- Our first platform user is created by a one-off script
  (`scripts/create-platform-user.ts`) with the service role, same pattern as
  `seed-demo-logins.ts`.

## 7. Payments: Stripe Connect

### Secrets

`STRIPE_SECRET_KEY`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `PLATFORM_DOMAIN` as
edge-function secrets. Nothing Stripe-related reaches the browser except the
Checkout redirect URL.

### Edge functions (new)

`stripe-connect-onboard` — admin of an organization only.
Creates an Express account if `stripe_account_id` is null (country US,
capabilities `card_payments`, `us_bank_account_ach_payments`, `cashapp_payments`,
`transfers`), stores the id with the service role, then creates an Account Link
with `refresh_url` and `return_url` pointing at `/app/settings?tab=payments`.
Returns the link URL. Idempotent: calling it again just makes a fresh link.

`stripe-checkout` — tenant only, through `userClient` so RLS applies.
Input: `invoice_ids[]`. Verifies every invoice is on one of the caller's leases
and has a positive open balance, else 403. Amount = sum of open balances.
Creates a Checkout Session **on the connected account** (`Stripe-Account` header)
with `mode: payment`, `payment_method_types: ['card','us_bank_account','cashapp']`,
`payment_intent_data.application_fee_amount` from `platform_fee_bps`,
`metadata: { org_id, lease_id, invoice_ids (comma list), tenant_id }`,
`success_url` and `cancel_url` on `portalUrl(org)`. Returns the session URL.
Refuses when `stripe_charges_enabled` is false or `online_payments` is off.

`stripe-webhook` — anonymous, signature-verified with the Connect endpoint
secret. Resolves the organization from `event.account`. Handles:

| Event | Action |
| --- | --- |
| `account.updated` | set `stripe_charges_enabled`, `stripe_details_submitted` |
| `payment_intent.processing` | upsert payment `pendiente`, method from the payment method type, `reported_by_tenant=false`, note "Stripe"; allocations not yet |
| `payment_intent.succeeded` | upsert payment `confirmado`, `confirmed_at=now()`, create allocations oldest-first over the metadata invoice ids, update each invoice status |
| `payment_intent.payment_failed` / `canceled` | payment `cancelado`, `void_reason` from the failure message |
| `charge.refunded` (full) | payment `cancelado`, `void_reason='refunded'`, delete its allocations, recompute invoice statuses |

Method mapping: `card → card`, `us_bank_account → ach`, `cashapp → cash_app`.
Upsert key is `stripe_payment_intent_id`, so a replayed event is a no-op.
Every branch runs with the service role and sets `org_id` explicitly.

### One place for "confirm a payment"

Staff confirmation in `app.payments.index.tsx` currently allocates and sets
invoice status in the browser. That logic moves into one SQL function,
`public.confirm_payment(payment_id uuid)`, which allocates oldest-first across
the lease's open invoices (or the given invoice ids), writes
`payment_allocations`, and sets each invoice to `pagado`, `pagado_parcial`, or
`enviado`. The staff page and the webhook both call it. The TypeScript
`allocateOldestFirst` stays for the preview the staff page shows before
confirming; its test becomes the reference the SQL function is checked
against.

### Tenant portal

The disabled "Pay online" button becomes live: "Pay" on each open invoice and
"Pay balance" on the home card call `stripe-checkout` and redirect. After
return, the invoice shows "Processing" while an ACH payment is pending and
"Paid" once the webhook confirms. The self-report form stays for cash, check
and money order and loses `ach`, `zelle` and `card` from its method list.

### Settings page, Payments tab

Shows Stripe status: not started, onboarding incomplete (with a "Continue"
button that re-calls `stripe-connect-onboard`), or enabled with a link to the
Express dashboard. Admin only.

## 8. Anonymous flows

- `tenant-self-enroll`: already matches an existing tenant by email. The
  tenant row carries `org_id`, so the profile and the email links take it from
  there. No host needed.
- `submit-access-request`: the form posts the current host. The function
  resolves the organization with `org_for_host`; if that fails it tries the
  tenant email match; if both fail it returns the same body and timing and
  stores nothing. On the platform apex, where no organization resolves, the
  request-access page is not linked; the landing page keeps "Book a meeting".

## 9. Migration of the El Paso client

One migration, in this order:

1. Create `organizations`; insert org one from the current `settings` row
   (name, logo), slug chosen with the client, modules = the current nav plus
   `receipts`, `import`, `access_requests`.
2. Add nullable `org_id` to every table, backfill with org one, set not null,
   add indexes and the trigger.
3. Change the unique constraints in 3.4; rewrite the two sequence functions.
4. Rewrite policies, views and storage policies.
5. Move storage objects under the `<org_id>/` prefix and rewrite the stored
   paths (`receipt_url`, `logo_url`, `documents.url`, `work_order_photos.url`).
   A script does this through the storage API; it is the only step that is not
   plain SQL.
6. Regenerate `database.types.ts` and `setup.sql`.

The seed keeps producing one organization so demo data still works.

## 10. Testing

- `supabase/tests/rls_test.sql` gains organization two with its own admin,
  manager, property, unit, lease and tenant. New assertions: org-one admin and
  manager cannot select, insert, update or delete any org-two row on every
  table; cannot read org-two storage paths; cannot read org-two settings
  through `public_settings`; a platform user reads both `organizations` rows
  and zero rows of client data; a tenant is unchanged. The suite stays
  transactional.
- `bun test`: module filter (nav and guard), `org_for_host` host parsing done
  in SQL is covered by an RLS-suite assertion, Checkout amount computation,
  and the webhook's event-to-status mapping as a pure function.
- `confirm_payment` is asserted in SQL against the same cases as
  `allocateOldestFirst`'s unit test.
- Stripe test mode end to end: onboarding, card, ACH (test account numbers
  with instant success and with delayed failure), Cash App Pay, full refund.
- Locale parity stays exact; every new string lands in both locale files.

## 11. Rollout order

1. Tenancy migration, policies, storage, RLS suite. Deploy. Nothing user-visible changes.
2. Organization settings, theme override, module filter, host resolution, wildcard domain.
3. Platform role, `/platform` page, invite with `org_id`, email identity helper.
4. Stripe Connect: onboarding, Checkout, webhook, `confirm_payment`, portal buttons.
5. Move the El Paso client's storage paths; add their custom domain if they want one.

Each step ships on its own and is verified with the full check list in
`SETUP.md` before push, because `main` deploys to production.

## 12. Onboarding runbook (our team)

1. Create the organization in `/platform`: name, slug, colors, modules.
2. Invite the first admin. They set a password and land on an empty dashboard.
3. Sit with them and run the CSV import for units, tenants, leases.
4. They upload a logo and fill company details and payment instructions in Settings.
5. They click "Set up payouts" and complete Stripe onboarding.
6. Optional: add their domain in Vercel, set `portal_domain`, they add a CNAME.
7. They invite tenants from the Tenants page.
8. We invoice the client outside the product.

## 13. Defaults the owner may override

- The landlord absorbs card and ACH processing fees.
- Express accounts rather than Standard.
- Texas compliance on for every organization.
- One email, one account, platform-wide.
