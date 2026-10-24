# Testing — QA checklist before merge

> Act as the QA tester, not the author. Run the gates, then walk every case
> in the sections the change touches, plus **Always**. Record the result in
> `docs/reports.md` as a table (case id, pass/fail, what you saw). A failure
> becomes an entry in `docs/bugs.md`. Do not merge with a red gate.
>
> `main` deploys to production on push. This list is the last thing between
> a change and real tenants' rent.

Demo logins: `bun run db:demo-logins` prints the current set. Tenant logins
change on every reseed, so trust that output, not a doc.

---

## 1. Gates (every change, no exceptions)

| # | Command | Pass means |
|---|---|---|
| G1 | `bun test` | all pass (52 on 2026-10-21) |
| G2 | `bunx tsc --noEmit` | no output |
| G3 | `bunx eslint .` | 0 errors (12 known fast-refresh warnings are fine) |
| G4 | `bun run build` | `✓ built` |
| G5 | `psql "$DATABASE_URL" -f supabase/tests/rls_test.sql` | every assertion passes. **Required** if a migration, policy, view or storage rule changed |
| G6 | `bun run db:setup` then `git diff --stat supabase/setup.sql` | regenerated if any migration or `seed.sql` changed |
| G7 | `bun run db:types` | `database.types.ts` matches the schema after a migration |
| G8 | `deno check` on changed edge functions | every import is `npm:` or `jsr:`. Bare specifiers typecheck locally and then fail the remote deploy |

---

## 2. Always (any UI change)

- [ ] **A1 Locale parity**: every new string is in both `src/locales/en.json` and `es-MX.json`. G1 enforces the keys; you check that the Spanish copy actually reads as Spanish.
- [ ] **A2 Both languages**: open the changed screen in English and in Spanish. No raw keys like `payments.title` on screen.
- [ ] **A3 Mobile**: tenant portal screens work at 375px wide with one thumb. Staff screens work on a tablet.
- [ ] **A4 Both themes**: light and dark. Text on tinted badges stays readable.
- [ ] **A5 Status not by colour alone**: every badge has text.
- [ ] **A6 Keyboard**: tab through the form; focus is visible; Enter submits; Esc closes dialogs.
- [ ] **A7 Empty, loading, error**: the screen with zero rows, while loading, and with the network offline.
- [ ] **A8 Console**: no red errors in the browser console during the flow.

---

## 3. Access and isolation (any auth, RLS, route-guard or query change)

- [ ] **S1** Tenant A cannot see tenant B's invoice by editing the id in `/portal/receipts/<id>`. Expect not found, never B's data.
- [ ] **S2** Tenant cannot open any `/app/*` URL. Expect a redirect to the portal.
- [ ] **S3** Manager cannot void a payment, delete records, change a lease's rent, or manage users. Admin can.
- [ ] **S4** Tenant sees only tenant-visible maintenance notes. Internal notes never appear in the portal or the API response.
- [ ] **S5** `generate-invoice-pdf` called by a tenant for someone else's invoice returns not found.
- [ ] **S6** Uploaded documents open only through signed URLs. Copy the URL into a private window after it expires and it should fail.
- [ ] **S7** Social sign-in with an email that has no profile signs straight back out and points at `/request-access`. No redirect loop.
- [ ] **S8** `tenant-self-enroll` and `submit-access-request` return the same body and similar timing for a known email, an unknown email, and garbage input.

---

## 4. Staff portal

### Properties and units
- [ ] **P1** Create a property with a full address, add a unit, then edit both. Values persist after a reload.
- [ ] **P2** Unit status follows its lease: an active lease makes it occupied; terminating the lease makes it vacant.

### Tenants and invites
- [ ] **T1** Create a tenant and send the invite. The invite is minted with `generateLink` and sent through Resend, never `inviteUserByEmail`.
- [ ] **T2** If email delivery fails, the response is `{ invited: true, emailed: false }` and the profile still exists. No login without a profile.

### Leases
- [ ] **L1** Lease wizard creates a lease with a primary tenant, co-tenant and guarantor.
- [ ] **L2** Grace days below 2 are refused: in the form, and by the database check constraint if you bypass the form (§92.019).
- [ ] **L3** A late fee above the cap is refused: 12% of rent if the structure has 4 or fewer units, 10% if it is larger or the size is unknown.
- [ ] **L4** Terminate with a forwarding address. The deposit due date is 30 days later, and the deposit clock turns amber at 7 days left and red at 3.
- [ ] **L5** Deposit disposition PDF itemizes deductions, the refund equals deposit minus deductions, and it renders in the tenant's language.
- [ ] **L6** Notice to vacate PDF (§24.005) renders in the tenant's language with the chosen delivery method.
- [ ] **L7** New lease creates the turnover checklist; rekey is due within 7 days of the lease start (§92.156).

### Receipts (monthly invoices)
- [ ] **R1** Generate the month: one draft per active lease, with rent plus assigned parking.
- [ ] **R2** Run generation again for the same month and confirm there are **no duplicates** (unique on lease and month).
- [ ] **R3** Leases skipped by generation are listed with a reason.
- [ ] **R4** Send: the tenant gets an email with the PDF attached; the PDF shows Total, Paid and Balance and the payment instructions.
- [ ] **R5** "Apply late fee" is disabled until the day after the second full day past due (or the lease's longer grace), with a tooltip naming the date.
- [ ] **R6** "Overdue" is derived from the due date. Nobody sets it by hand.

### Payments
- [ ] **$1** Record a cash payment larger than the oldest open invoice. It allocates oldest-first and the remainder lands on the next invoice.
- [ ] **$2** Over-payment becomes a credit on the lease.
- [ ] **$3** Confirm a tenant-reported payment from the queue. The balance updates for staff and tenant.
- [ ] **$4** Reject a reported payment with a reason, as admin **and** as manager (see B-014). The tenant sees it was rejected.
- [ ] **$5** Admin voids a payment with a reason. The row stays in the ledger as voided, the allocations are removed, and invoice statuses recompute.
- [ ] **$6** Every insert, confirm and void writes to `activity_log` with the actor.

### Expenses and reports
- [ ] **E1** Add an expense to a unit. It rolls up under its property.
- [ ] **E2** Reports: rent income (confirmed payments only) vs expenses for 12 months, filtered by property and by unit, and the totals match a hand count.
- [ ] **E3** Payments CSV export opens in a spreadsheet with correct columns and amounts. (Reports has no export today, see PRD §4.1.)

### Maintenance
- [ ] **M1** A portal-created order sets `written_notice_at` and starts the 7-day repair clock (§92.052 / §92.056). The clock turns amber on day 5.
- [ ] **M2** Move an order to Completed and then reopen it. `resolved_at` clears and the clock runs again.

### CSV import
- [ ] **I1** Download each template (units, tenants, leases), upload it with one bad row, and confirm the preview flags that row and nothing is written.
- [ ] **I2** Commit, then re-run the same file. No duplicates.

---

## 5. Tenant portal

- [ ] **U1** Home shows the balance owed and the due date, or the "up to date" state when nothing is owed.
- [ ] **U2** Payment instructions show, each with a working copy button.
- [ ] **U3** Report a payment with a photo of the receipt. It shows as pending until staff act on it, **and staff see the photo** in the queue (B-012).
- [ ] **U4** Receipts list, receipt detail and PDF download (§92.011).
- [ ] **U5** Lease view and signed-lease download (§92.024).
- [ ] **U6** New maintenance request with photos. It shows up on the staff board as New, with source = portal.
- [ ] **U7** Profile: change phone and language. Language persists after signing out and back in.

---

## 6. Dates, money, time

- [ ] **D1** Between 6pm and midnight Mountain Time, "today" is still today: due-today invoices are not overdue and the late-fee date does not move. Test by faking the clock in a unit test, or by running the flow in that window.
- [ ] **D2** Money shows as `$1,234.50` with tabular numerals, and sums never pick up float residue (`0.1 + 0.2`).
- [ ] **D3** Dates display as `mm/dd/yyyy`. A `date` column is a calendar date, not a UTC instant.

---

## 7. Next phases (from the multi-tenant spec, enable when they land)

- [ ] **O1** Org-one admin and manager cannot select, insert, update or delete any org-two row on any table, or read org-two storage paths.
- [ ] **O2** A platform user reads both organizations and zero rows of client data, and is redirected to `/platform`.
- [ ] **O3** `<slug>.<platform-domain>` shows that organization's logo and colours before hydration.
- [ ] **O4** A disabled module is hidden from the nav, and its URL redirects to `/app`.
- [ ] **O5** Stripe test mode: card success, ACH with instant success and with delayed failure, Cash App Pay, full refund. Replaying a webhook event changes nothing.
- [ ] **O6** `confirm_payment()` in SQL gives the same allocations as `allocateOldestFirst` for every case in `invoicing.test.ts`.
