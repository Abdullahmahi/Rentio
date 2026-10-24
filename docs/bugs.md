# Bugs

> **Rule: no code before a hypothesis.** For every bug, fill in Symptom →
> Evidence → Files → Hypothesis, and confirm the hypothesis by reproducing or
> by reading the code path end to end, **before** you edit anything. Then fix
> it at the root (the shared function every caller goes through, not just the
> caller named in the report) and leave one test that would have caught it.
>
> ⚠️ **This repo is public.** A security bug (cross-tenant read, privilege
> escalation, auth bypass, leaked key) goes in `docs/security.md`, which is
> gitignored, and is referenced here by its `S-` id only. Never paste
> secrets, tokens or real tenant data into either file.

## Template

```markdown
### B-000 · <short title>
- **Status:** open | diagnosing | fixed (<commit>) | won't fix (<why>)
- **Severity:** P0 money or data wrong / tenant isolation · P1 flow blocked · P2 wrong but has a workaround · P3 cosmetic
- **Found:** YYYY-MM-DD, by <who or which audit>
- **Symptom:** what the user sees, in their words
- **Repro:** numbered steps, which login, which record
- **Evidence:** console error / network response / SQL error, verbatim
- **Files:** `path:line` for each file on the code path
- **Hypothesis:** the cause, and the observation that would prove it wrong
- **Confirmed by:** what you ran or read that proved it
- **Fix:** what changed and where; why that is the root, not the symptom
- **Guard:** the test that fails without the fix (`file › test name`)
```

## Open

<!-- Newest first. Entries found by the 2026-10-21 baseline audit were read
     from the code, not reproduced. The Hypothesis line says what to check first. -->

**Security (details in `docs/security.md`):** S-001 P0 · S-002 P0 · S-003 P0 ·
S-004 P1 · S-005 P1 · S-006 P1 · S-007 P2 · S-008 P2 · S-009 P2 · S-010 P3.
Fix S-001 to S-003 before anything else.

| Severity | Bugs |
|---|---|
| P1 | B-011 money input · B-012 tenant receipt lost · B-013 payment confirm not atomic · B-001 invite pagination · B-002 invite overwrites role |
| P2 | B-014 manager reject/delete · B-015 line language · B-016 stuck skeleton · B-003 · B-004 · B-006 · B-007 · B-008 · B-009 |
| P3 | B-005 · B-010 · B-017 small UI |

### B-011 · Cents can't be typed into any money field
- **Status:** open · **Severity:** P1 · **Found:** 2026-10-21, baseline audit
- **Symptom:** typing `1250.50` key by key gives `125050`. The "." vanishes as soon as it is typed. This affects 11 forms, including the tenant's report-payment form.
- **Files:** `src/components/rentio/money-input.tsx:26,41-45`. The input is controlled by a `number`: `Number("12.")` is `12`, which renders as "12".
- **Hypothesis:** confirmed by reading; reproduce in the browser first. Prove it wrong: type `12.5` and the field shows `12.5`.
- **Fix direction:** keep the raw string as display state and emit the parsed number. The fix is in the one shared component, so all 11 callers are covered.
- **Guard:** a unit test of the parse step over `"12."`, `"12.5"`, `"1,250.50"` and `""`.

### B-012 · The tenant's proof of payment never reaches staff
- **Status:** open · **Severity:** P1
- **Symptom:** a tenant reports a payment with a photo, and staff see the claim with no photo.
- **Files:** `src/routes/portal.report-payment.tsx:73-76` uploads the file, then calls `update({ receipt_url })` as the tenant. `rls.sql:217` (and `:236-239`) means tenants can never update payments, so 0 rows match, and the result is not checked.
- **Hypothesis:** confirmed by reading. The file sits orphaned in `payment-receipts/<lease>/`.
- **Fix direction:** upload first, then insert the payment with `receipt_url` already set. That makes one write and needs no policy change.
- **Guard:** an RLS-suite assertion that a tenant insert with `receipt_url` keeps it, plus `testing.md` U3.

### B-013 · Confirming a payment is four browser writes with no transaction
- **Status:** open · **Severity:** P1 (money)
- **Files:** `src/routes/app.payments.index.tsx:335-398`
  - The flow updates the status, inserts allocations, recomputes each invoice's status, then logs.
  - `refreshInvoiceStatuses` ignores errors.
  - The flow allocates against the cached `openInvoices` query, but the loading gate (`:657`) doesn't wait for it.
  - There is no `.eq('status','pendiente')` guard.
- **Symptom:** a payment can end up confirmed with zero allocations (insert failed, or invoices not loaded yet), or double-allocated if two staff confirm at once. The balance looks paid while the invoice stays open.
- **Fix direction:** this is already in the plan. `public.confirm_payment(payment_id)` in SQL, from multi-tenant spec §7 ("One place for confirm a payment"), which the Stripe webhook also needs. Do it as its own task before phase 4, checked against `allocateOldestFirst`'s test cases.

### B-014 · Managers are shown buttons the database refuses
- **Status:** open · **Severity:** P2
- **Files:**
  - Expense delete: `app.expenses.index.tsx:165-176,233-240`. RLS is admin-only and the delete silently matches 0 rows, so the manager sees a "deleted" toast and an activity-log entry while nothing is deleted.
  - Utility-charge delete: `app.services.index.tsx:244-251`.
  - Payment **reject**: `app.payments.index.tsx:863-873`. Reject sets `cancelado`, which is admin-only (`rls.sql:236-239`), so the manager gets a forbidden toast.
- **Product question:** the PRD says managers confirm *and reject* tenant reports. Either reject needs its own status (`rechazado`) that managers may set, or reject stays admin-only and the button is hidden. Ask the owner.
- **Fix direction:** wrap the delete buttons in `AdminOnly`. Have every delete check the returned row count and throw on 0.

### B-015 · Invoice lines are stored in the staff member's UI language
- **Status:** open · **Severity:** P2
- **Files:** `app.receipts.index.tsx:117-118`, `app.receipts.$id.tsx:222`; shown as stored at `portal.receipts.$id.tsx:110`.
- **Symptom:** a Spanish-speaking tenant sees "Rent" and "Late fee" on their receipt.
- **Fix direction:** render the line label from `category` in the viewer's locale and keep `description` for custom lines only.

### B-016 · Signed in with no profile row shows a skeleton forever
- **Status:** open · **Severity:** P2
- **Files:** `src/components/rentio/require-role.tsx:56,60`; `src/lib/auth.tsx:57` (profile fetch error ignored).
- **Symptom:** `/activate` or a deep link with a missing profile, or a failed fetch, never finishes loading. `/sign-in` already handles this case; the guard doesn't.
- **Fix direction:** in the guard, a user with no profile after loading → sign out → `/request-access`, the same as sign-in does.

### B-017 · Small UI issues (batch these into one task)
- **Status:** open · **Severity:** P3
- Auth pages, including the tenant invite page `/activate`, default to English (`auth-layout.tsx:65`). Tenants should default to Spanish.
- The OAuth return drops `?redirect` (`sign-in.tsx:86`).
- The "resolved this month" count uses the browser's month, not Denver's (`app.maintenance.index.tsx:247-249`).
- No nav item is highlighted on detail pages, because the match is exact (`app-shell.tsx:72`, `portal-shell.tsx:44`).
- The error-page retry button reads "Confirm" (`__root.tsx:59`).
- The user-menu item "My profile" opens Settings (`app-shell.tsx:237`).
- Late-fee errors (`late-fee-too-early`, `late-fee-already-applied`) show only the generic toast (`app.receipts.$id.tsx:207,217`).
- `/reset-password` with an expired link shows a generic error (`reset-password.tsx:31-48`).
- Invoice generation leaves a gap in numbering when it hits a duplicate (`app.receipts.index.tsx:128-164`).

### B-001 · Invite fails for users past the first 50
- **Status:** open · **Severity:** P1 (about 120 tenants will hit it) · **Found:** 2026-10-21, baseline audit
- **Symptom:** re-inviting an existing user errors, or emails them a link that doesn't work.
- **Files:** `supabase/functions/send-tenant-invite/index.ts:57`, `send-staff-invite/index.ts:32`. `listUsers()` is called without pagination, and GoTrue's default page is 50. `scripts/seed-demo-logins.ts:35-44` already paginates correctly.
- **Hypothesis:** an existing user beyond page 1 is not found, so the function asks for an `invite` link for an email that already exists and GoTrue refuses. Prove it wrong: with more than 50 auth users, re-invite one created late and the call succeeds.
- **Fix direction:** look the user up by email, not by listing. Put it in `_shared/common.ts` so both functions use the one helper.

### B-002 · Re-inviting someone overwrites their role
- **Status:** open · **Severity:** P1
- **Files:** `send-tenant-invite/index.ts:82-86` upserts `role: 'tenant'`; `send-staff-invite/index.ts:52-56` clears `tenant_id`.
- **Symptom:** a manager types an admin's email into the tenant invite, and the admin is demoted to tenant.
- **Fix direction:** refuse when the existing profile has a different role. Never upsert `role` onto an existing row.

### B-003 · The invoice email may show a blank unit number
- **Status:** open, **needs repro** · **Severity:** P2
- **Files:** `send-invoice-email/index.ts:25` reads `my_lease_details` with the service client; the view filters `where is_staff() or l.id in (select my_lease_ids())` (`…us_localization.sql:58`), and both helpers are null without a user.
- **Hypothesis:** the view returns 0 rows, so "Unidad" is blank in the subject and body. This **contradicts** SETUP.md, which records a delivered subject "… Unidad 102". Send one email from staging first. If the unit shows, find out why before touching anything.
- **Fix direction:** join `leases → units → properties` directly with the service client.

### B-004 · The late-fee database guard uses UTC, the UI uses Mountain Time
- **Status:** open · **Severity:** P2 (the UI blocks it first, but the database is the last line)
- **Files:** `supabase/migrations/20260920001000_late_fee_guard.sql:40` (`current_date`) against `src/lib/format.ts` (`America/Denver`).
- **Hypothesis:** from 6pm Mountain Time the database thinks it is already tomorrow, so a direct insert can apply a fee about 6 hours before §92.019 allows it.
- **Fix direction:** `(now() at time zone 'America/Denver')::date` in the trigger; add an RLS-suite case.

### B-005 · Two simultaneous late fees can both pass the guard
- **Status:** open · **Severity:** P3
- **Files:** `late_fee_guard.sql:50-60` (`count(*)` inside the trigger).
- **Fix direction:** a partial unique index on `invoice_lines (invoice_id) where category = 'recargo'`.

### B-006 · `invoices.total` is kept in sync by the browser
- **Status:** open · **Severity:** P2
- **Files:** `src/routes/app.receipts.$id.tsx:158-168` (`syncTotal()` after each line change, outside a transaction); `schema.sql:142`.
- **Symptom:** the PDF adds up the lines itself while the email uses `invoices.total`, so a failed sync leaves the two disagreeing.
- **Fix direction:** a trigger on `invoice_lines` that recomputes `invoices.total`; delete `syncTotal()`.

### B-007 · `tenants.email` is not unique
- **Status:** open · **Severity:** P2
- **Files:** `schema.sql:68`; `tenant-self-enroll` and `submit-access-request` use `.maybeSingle()`.
- **Symptom:** two tenants share an email, and self-enroll silently does nothing for either.
- **Fix direction:** a unique index on `lower(email)` where email is not null. Clean the duplicates first.

### B-008 · Tenants can see draft invoices
- **Status:** open · **Severity:** P2
- **Files:** `rls.sql:191-193`; `src/lib/queries.ts:296-300`.
- **Symptom:** the portal shows a `borrador` invoice that staff are still editing.
- **Fix direction:** add `status <> 'borrador'` to the tenant branch of the invoices policy, which also covers lines and the PDF.

### B-009 · The receipt PDF is Spanish-only and A4
- **Status:** open · **Severity:** P2
- **Files:** `supabase/functions/generate-invoice-pdf/index.ts`; `send-invoice-email` (Spanish body, English footer).
- **Symptom:** an English-speaking tenant gets "Recibo de renta" on A4 paper in a US market. The notice and disposition PDFs already follow the tenant's locale.
- **Fix direction:** pick the language from the tenant's `profiles.locale`, as the notice does, and use US Letter.

### B-010 · Missing integrity constraints
- **Status:** open · **Severity:** P3
- **Files:** `supabase/migrations/20260919000100_schema.sql`
- **Gaps:** no `end_date > start_date`; nothing stops overlapping active leases on one unit; allocations can exceed the payment amount; no unique `(payment_id, invoice_id)`; nothing enforces one primary tenant per lease; `turnover_set_completed_at` fires on UPDATE only.
- **Fix direction:** constraints, one migration. Check the seed passes them first.

## Fixed

<!-- Move entries here with the commit hash. Keep them as a record of what broke and why. -->
