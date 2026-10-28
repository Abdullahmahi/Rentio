# Verified QA findings — 2026-10-27

Verification pass over `docs/qa/qa-a-findings.md` (A-01..A-25), `docs/qa/qa-b-findings.md` (B-01..B-34) and the tester's `docs/qa-report-2026-10-27.md`, against the **current files** (HEAD `8e8be01` plus the uncommitted working tree as of this pass). Every cited `file:line` was opened. Gates on the working tree: `bun test` 52/52, `bunx tsc --noEmit` clean. Read-only; nothing was edited.

Verdict key: **CONFIRMED** (real, still open) · **FIXED** (real, addressed in HEAD or the working tree and the fix checked) · **PARTIAL** (real, part fixed, residual listed) · **UNSURE** (plausible, not provable from code) · **REJECTED** (wrong). "HEAD" = commit 8e8be01; "WT" = uncommitted working tree.

## Executive summary

1. Both agents were accurate: 59 findings, 0 rejected, 1 unsure (B-07's mechanism). Nothing they reported wastes engineering time; a few "smallest fixes" are not the smallest.
2. 39 of 59 are already fixed (23) or half-fixed (16) in HEAD + working tree; 19 remain open, 1 unsure (super_admin scoping, admin→platform hole, error messages, language toggle, tenant→lease resolution, renew start date, sign-in dead ends, invite badge, a dozen UI items).
3. The one open **money** bug: `planMonthlyInvoices` bills by status only (A-02). Until the date filter lands, "Generate this month's receipts" bills ended leases and double-bills renewed units. Fix before anyone clicks Generate for November.
4. Three regressions/omissions in the new code that neither QA could see: `supabase/setup.sql` is stale against the committed migration (the installer lacks the A-01 fix); six new locale strings are double-escaped (`\\u2019` renders literally); the new `P0001` branch in `describeError` never catches the Texas late-fee guard (it raises `check_violation`).
5. Clerk's own log text says "instance keys do not match"; B-07 attributes the loop to a dev instance/proxy. Check that `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` come from the same instance before anything else.
6. The tester's data (property "Testing", two active T1 leases) and the seed demo portfolio appear to live in the same company the first client is entering real buildings into. That is the real billing risk behind "I did not click Generate".
7. Owner decisions that gate the rest: holdover rule for expired leases, auto-generation of receipts, cash- vs invoice-basis "collected", end-date on move-out, guarantor portal access, document language, parking/requests in the nav, demo data purge.
8. Six duplicates across A and B (listed in the table); two genuine contradictions (B-13 vs A-12 on client-supplied deductions; B-07 vs Clerk's message).
9. Grades: QA-A precision 25/25, strongest on data/money, one risky fix (exclusion constraint on live data). QA-B precision 33/34, broadest coverage, one weak diagnosis (B-07).
10. Next 2 weeks, in order: A-02 → regenerate setup.sql + fix locale escapes → purge demo data (owner) → the (a) list below → owner answers (b).

## Verdict table

| ID | Verdict | One-line reason | Duplicate of / relation |
|---|---|---|---|
| A-01 | FIXED (HEAD) | `is_super_admin()` now requires `org_id is null`; trigger refuses `role='super_admin'`, org moves, and non-tenant inserts from non-admins; 3 new RLS assertions. Exploit recipe intentionally not repeated here (public repo). | — |
| A-02 | **CONFIRMED (open)** | `invoicing.ts:102` filters `isActive(lease)` only; nothing compares `start_date`/`end_date` to the period. Ended leases and both halves of a renewal get billed. | knock-on of A-05/B-03 |
| A-03 | CONFIRMED (owner) | No write of `terminado` other than move-out; no scheduler anywhere. `isExpiringSoon` also hides `days < 0`. | B-19 is the frontend half |
| A-04 | CONFIRMED (owner) | Generation is browser-only, per-lease RPC+insert+insert, no transaction (`app.receipts.index.tsx:123-170`). | — |
| A-05 | PARTIAL (WT) | `seedFromLease` now sets `startDate = end_date + 1` and the wizard uses it (dead ternary gone). Old lease still stays `activo`; no overlap constraint. The suggested `btree_gist` exclusion constraint would fail to apply on the live DB (tester already created overlapping T1 leases). | = B-03 |
| A-06 | FIXED (WT) | New `currentLeaseFor`/`currentLeaseByTenant` in `portfolio.ts` rank primary → co-tenant, never guarantor; used by tenants list, tenant detail and `useMyPortal` (which now reads `lease_tenants` roles). Seed claim verified (`seed.sql:259-272`). | = B-04 |
| A-07 | PARTIAL (HEAD) | `/request-access?org=<slug>` is read and sent. Residual: `/sign-in` still links to `/request-access` without a slug, so once a second company exists, requests from that path are silently dropped (`submit-access-request.ts:42`). | — |
| A-08 | FIXED (HEAD) | `organizations_create_settings` trigger inserts the settings row; with the org switcher, a super_admin acting in a company can invite its first admin (`invite.ts:27` passes). Creating the org itself is still service-connection SQL (fine as the documented step). | — |
| A-09 | FIXED (HEAD) | `useSettings` returns `null` in platform view; `org_isolation_update` is `mine`-only, so no cross-org write is possible even via API. | B-09 |
| A-10 | FIXED (HEAD) | With an org picked, `current_org_id()` is that org, so `next_invoice_number()` uses its prefix; with none picked, inserts are refused by `org_isolation_insert`. Residual UX: in platform view the Generate dialog still plans every company's leases before failing with `errors.noCompany`. | B-09 |
| A-11 | FIXED (HEAD) | `session.profile.org_id` is the acting org, so storage/PDF/email/invite routes work; 403 in platform view is now by design (read-only). | B-09 |
| A-12 | FIXED (WT) | Download button now `disabled` until `deposit_settled_at`; PDF still prints the saved itemization (correct: it is the §92.104 record). | = B-13 |
| A-13 | PARTIAL (WT) | Move-out only sets `vacante` when no other active lease is on the unit (client-side check on `portfolio.data`). Still 3 browser writes; `end_date` untouched (owner question). | = B-10 |
| A-14 | FIXED (WT) | `status` removed from the update payload; insert derives `terminado` when `end_date < todayIso()`. | — |
| A-15 | CONFIRMED (owner) | `my_lease_ids()` joins `lease_tenants` with no role filter; guarantors see invoices, payments, work orders and can report payments. | — |
| A-16 | CONFIRMED (owner) | Dashboard sums `invoice_balances.paid` bucketed by invoice `period_month`; Reports sums confirmed payments by `paid_at`. `invoice_balances` fetched unfiltered. | = B-20 |
| A-17 | CONFIRMED (owner) | `work_orders.cost` is only written to `work_orders`; Reports reads `expenses` only. | — |
| A-18 | CONFIRMED (owner) | Late fee is inserted only by the button; the trigger guards, never applies. | — |
| A-19 | PARTIAL (HEAD) | `forgetProfile` now called from `invite.ts` and from the `/rest/v1` proxy on `PATCH profiles`. Residual: `profile: null` is still cached 60 s, and a brand-new invite cannot evict a login it does not know. | — |
| A-20 | FIXED (HEAD) | `invoice-pdf.ts` sanitises the folio (`safeNumber`) before building the storage path. | — |
| A-21 | PARTIAL (WT) | Disposition "Issued" now `todayIso()`; `repairClock` converts timestamps via `todayIso(new Date(ts))`. Residual: SQL `current_date` in `lease_balances` (`schema.sql:380`), `deposit_obligations`, and the late-fee guard (= known B-004). | — |
| A-22 | PARTIAL (HEAD) | `my_lease_details` tenant branch pinned to `l.org_id = current_org_id()`. The `lease_tenants` cross-org check is not added; needs a foreign UUID to exploit, table rows stay org-isolated. Low. | — |
| A-23 | CONFIRMED (open) | `new URL("null")` throws `TypeError` (verified); `errorMiddleware` turns it into a 500 page. | — |
| A-24 | FIXED (WT) | `parseDate` checks `getDate() === day`; number cells strip thousands commas only when the pattern is `1,234(.5)`. Both claims reproduced in bun before the fix. | — |
| A-25 | CONFIRMED (open) | `derivedKey` has no length check; `/api/files` needs no session. Only matters if `POSTGREST_JWT_SECRET` is unset (then every other route already fails). | — |
| B-01 | FIXED (HEAD, extended WT) | postgrest-js 2.116 returns a plain object (`dist/index.mjs:480-494`); `describeError` now reads `message`/`code` off any object. | ⊂ B-11 |
| B-02 | FIXED (WT) | Verified in `react-i18next/useTranslation.js:124-151`: the `useMemo` deps include `finalI18n.language`, so a new wrapper per language change re-ran the effect with the stale `profile.locale`. Fix uses the module singleton and `patchProfile({locale})`; the proxy's `forgetProfile` on `PATCH profiles` covers the 60 s cache. | — |
| B-03 | PARTIAL (WT) | Start date fixed; closing the old lease is the owner question. | = A-05 |
| B-04 | FIXED (WT) | See A-06. | = A-06 |
| B-05 | FIXED (WT) | Sign-in renders a spinner + `auth.checkingSession` when `user` is set instead of `<SignIn>`. The "Clerk card renders blank when signed in" premise is not provable from code but the missing state was real. | — |
| B-06 | FIXED (WT) | `AuthProvider` now exposes `accessError: no_profile / suspended / failed`; sign-in shows a suspended message or a Retry button. | — |
| B-07 | UNSURE (owner) | The warning exists (`@clerk/backend/chunk-BEWRUSPG.mjs:7508`) but Clerk's full text says *"This usually means that your Clerk instance keys do not match"*, which B-07 did not quote. Dev-instance/proxy causes are plausible second-order explanations. Owner step either way. | tester C#1 |
| B-08 | FIXED (WT) | Banner links to the lease when there is one overdue deposit, else to `/app/contracts`. | — |
| B-09 | FIXED (HEAD) | Org switcher + cookie + JWT `org_id`; platform view is read-only by RLS. | = A-09/A-10/A-11 |
| B-10 | PARTIAL (WT) | See A-13. | = A-13 |
| B-11 | PARTIAL (WT) | 23503→`errors.inUse`, 401/PGRST301→`sessionExpired`, suspended, 23502/23514/22P02→`invalid`; dead `notConfigured*` keys removed. Residual: the Texas late-fee guard raises `check_violation` (23514), so its hand-written message still becomes generic "invalid"; the new `P0001` branch only catches `tenants_restrict_self_update`. Raw messages also pass through `t()` with the default `:` namespace separator. | ⊃ B-01 |
| B-12 | CONFIRMED (open + owner) | `properties.deleteDescription` has no `_one/_other`; `leases.unit_id` and `expenses.unit_id` are `on delete restrict` (`setup.sql:117,1550`), so a property with history fails to delete (now with the `inUse` message thanks to B-11). | — |
| B-13 | FIXED (WT) | See A-12. B-13's alternative ("pass itemization in the body") would let the client dictate the legal record; A-12's option was chosen, correctly. | = A-12 |
| B-14 | FIXED (WT) | Query selects `clerk_user_id`; NULL shows "Invited · pending" + Resend (same mutation). Revoke not built (owner). | — |
| B-15 | CONFIRMED (open + owner) | `/app/parking` exists (554 lines, full CRUD/assign) and nothing links to it; `nav-items.tsx:15-18` says so on purpose. | tester M#4 |
| B-16 | PARTIAL (WT) | Rent pencil now wrapped in `isActive(lease)`. No unit/tenant edit or delete, no work-order delete, as stated (grep confirms no mutations in `app.units.$id.tsx`; only invite in `app.tenants.$id.tsx`). | — |
| B-17 | CONFIRMED (open + owner) | Receipt PDF literals Spanish (`invoice-pdf.ts:153-190`), CSV names `pagos-/plantilla-/errores-`, disposition/notice follow tenant locale with `es-MX` default and `.maybeSingle()` over several primaries errors into Spanish. The utility-label point is moot (`pendingUtilities: []`). | known B-009 |
| B-18 | PARTIAL (WT) | Header figure now labelled "Base rent". Residual: unit page picks the *first* active lease (`find`), `unitContexts` the *last* (map overwrite); only visible while overlaps exist. | — |
| B-19 | CONFIRMED (tied to A-03) | `isExpiringSoon` requires `days >= 0`. | A-03 frontend half |
| B-20 | CONFIRMED (owner) | See A-16. | = A-16 |
| B-21 | PARTIAL (WT) | `DataTable` rows get `tabIndex=0` + Enter/Space. Maintenance board `<article onClick>` cards still mouse-only. | — |
| B-22 | FIXED (WT) | `Kpi` takes `to` and renders a `<Link>`; all six KPIs wired. | — |
| B-23 | CONFIRMED (open + owner) | "My profile" → `/app/settings`; requests banner only at >0 pending. | known B-017 |
| B-24 | PARTIAL (WT) | Property rows added to the palette. Work orders not (needs another query). | — |
| B-25 | CONFIRMED (open) | Card prints `Unit {n}` without property; "New" KPI is `summary.open`. | — |
| B-26 | FIXED (WT) | H&S badge renders without `written_notice_at`; photo insert error now thrown. | — |
| B-27 | PARTIAL (WT) | `sqm ?? "—"` (reads "— sq ft"; omitting the segment would be cleaner). Search still only inside `DataTable`, so the grid has none. | — |
| B-28 | CONFIRMED (open) | `setError(null)` only on submit/close (`payments.index.tsx:961,970`). | — |
| B-29 | PARTIAL (WT) | Vendor phone masked with `formatUsPhone`. `MoneyText` still paints every negative red. | — |
| B-30 | PARTIAL (WT) | Default notice type is `end_of_term` when balance ≤ 0. Notices still only in the Summary card, not Documents. | — |
| B-31 | CONFIRMED (open) | Three `EmptyState`s with no `actionLabel`; vacant-unit CTA goes to `/app/contracts` with no preselect. | — |
| B-32 | FIXED (WT) | "Reported by tenant" when `reported_by_tenant && !recorded_by`. | — |
| B-33 | FIXED (WT) | `aria-label` on the close button, `role="group"` + `aria-pressed` on language buttons. | — |
| B-34 | CONFIRMED (open + owner) | `expenses.unit_id NOT NULL`; `new Error("invalid")` maps to generic. | — |

### Found during verification (not in either list)

| ID | Verdict | What |
|---|---|---|
| V-01 | **CONFIRMED (HEAD)** | `supabase/setup.sql` section "16/17 20261027001500" was generated from an earlier draft of the migration: it contains `org_id is null` but not `org_isolation_select/insert/update/delete`, `organizations_create_settings` or the "Only PortfolioAI staff" guard (grep: 0 hits vs 4 in the migration). Anyone installing from `setup.sql` gets the old single `org_isolation` policy and no settings trigger. `bun run db:setup` and commit. |
| V-02 | **CONFIRMED (WT)** | Six new locale values are double-escaped: `auth.suspended`, `errors.suspended`, `tenants.portalInvitedPending` in both files carry literal `’`, `·`, `á`, `ú` (verified by `json.load`). They will render as backslash text. Parity test cannot catch it. Use the real characters. |
| V-03 | CONFIRMED (WT) | `describeError`'s `P0001` branch misses the late-fee guard (`check_violation`), the message B-11 was written for. Map `code === "23514" && /Texas Property Code/` → return the message, and pass `{ nsSeparator: false }` (or set it globally) when a raw message reaches `t()`. |
| V-04 | CONFIRMED (prod data) | The tester left two *active* T1 leases and a "Testing" property in the live company; the seed portfolio (Truman, Ysleta) is visible in the same company the first client is using. Any future unit-overlap constraint fails to apply until these rows are cleaned, and the next "Generate" bills fake leases. |

### Duplicates and contradictions

- Same bug, both lists: A-05=B-03, A-06=B-04, A-09/10/11=B-09, A-12=B-13, A-13=B-10, A-16=B-20; A-03 and B-19 are the two halves of tester C#2; B-11 extends B-01.
- B-13 vs A-12: B-13 offers rendering the PDF from client-sent deductions; A-12 is right that the §92.104 record must come from saved data. The working tree followed A-12.
- B-07 vs Clerk: Clerk's own message blames mismatched instance keys first; B-07 blames a dev instance on a real domain or proxy headers. Both are owner-side; check keys first.
- A-13 vs tester M#12: tester expects `end_date` to become the surrender date; A-13 recommends keeping the contract date and showing `move_out_date ?? end_date`. Owner question (b-4).
- Agents vs tester C#5 and M#1/M#2/M#4/M#6: the agents found different root causes than the tester described (UI role ranking, unlabeled base rent, unsaved dialog state, unlinked module, KPI definition). All verified; the tester's symptoms were accurate, the causes were not.

## Ranked fix list

Ranking: money and data integrity → blocks daily use for the first client → polish. "Smallest fix" is what I would write; sizes are honest.

### (a) Fix now, no owner input needed

| # | ID | Smallest fix | Size |
|---|---|---|---|
| 1 | A-02 | In `planMonthlyInvoices`, filter `isActive(lease) && lease.start_date <= lastDayOf(period) && lease.end_date >= period` (period is `YYYY-MM-01`); one test in `invoicing.test.ts` with an ended lease and a next-month renewal. Do this before November's Generate. | 4 lines + test |
| 2 | V-01 | `bun run db:setup`; commit the regenerated `setup.sql` with the migration. | 1 command |
| 3 | V-02 | Replace `\\u2019`/`\\u00b7`/`\\u00e1`/`\\u00fa` with the characters in both locale files. | 6 strings |
| 4 | V-03 / B-11 | In `describeError`: `if ((code === "23514" \|\| code === "P0001") && /Texas Property Code\|already has a late fee/i.test(message)) return message;` and in `useToastMutation` call `t(key, { nsSeparator: false })` for values not starting with `errors.`. | 3 lines |
| 5 | A-23 | Wrap the `new URL(origin)` compare in try/catch → 403. | 2 lines |
| 6 | A-25 | `derivedKey`: same `< 32` throw as `signJwt`. | 1 line |
| 7 | A-19 | In `requireSession`, only `cache.set` when `profile` is non-null. | 1 line |
| 8 | B-12 (part) | Add `properties.deleteDescription_one/_other` in both locales; in the confirm, if `leases.some(l => l.unit in property)` show "Remove its leases and payments first" and disable the button. The FK already blocks it; this just says so before the click. | ~10 lines |
| 9 | B-15 (part) | Add a "Manage parking" `<Link to="/app/parking">` in the lease Parking tab and the property Parking tab. No nav change. | 2 links |
| 10 | B-17 (part) | CSV names via `t()` (`payments.exportFileName`, `import.templateFileName`, `import.errorsFileName`); in the disposition and notice routes replace `.maybeSingle()` on profiles with `.limit(1).maybeSingle()`. | ~8 lines |
| 11 | B-18 (rest) | One `currentLeaseForUnit(contexts, unitId)` in `portfolio.ts` (prefer the lease whose dates cover today, else latest start) used by `unitContexts` and the unit page. | ~8 lines |
| 12 | B-21 (rest) | Maintenance cards: `role="button" tabIndex={0}` + the same `onKeyDown`. | 4 lines |
| 13 | B-25 | Card: `{row.propertyName} · {unit}` (board rows already join units; add property via `unitContexts`); KPI label key `maintenance.kpi.open`. | ~5 lines |
| 14 | B-27 (rest) | Lift one search input above the view toggle and pass it to both views; omit the sq ft segment when null. | ~15 lines |
| 15 | B-28 | `setError(null)` in the amount and lease `onChange`. | 2 lines |
| 16 | B-29 (rest) | `MoneyText` prop `tone?: "debt" \| "credit"`; default red only for `tone === "debt"`; balances pass `debt`. | ~5 lines |
| 17 | B-31 | `actionLabel`/`onAction` on the three empty states; vacant-unit CTA → `/app/contracts?new=1&unit=<id>` (wizard reads it). | ~15 lines |
| 18 | B-23 (part) | Rename `user.myProfile` to "Settings" in both locales. | 2 strings |
| 19 | B-34 (part) | In the expense dialog, `if (!values.unit_id) return setError(t("expenses.errors.unitRequired"))` instead of throwing. | 2 lines + key |
| 20 | A-10 (UX) | Hide the Generate button when `isSuperAdmin && !profile.org_id`. | 1 line |
| 21 | A-07 (part) | Carry `?org=` from `/sign-in` and `/signup` to `/request-access` when present (`search` passthrough). | 3 lines |

Skipped on purpose (YAGNI for 2 weeks): A-22's `lease_tenants` trigger, B-24 work-order rows, B-30 notices in Documents, A-21's remaining SQL `current_date` sites beyond B-004.

### (b) Needs an owner decision

| # | IDs | Question (plain) | Recommended answer |
|---|---|---|---|
| 1 | V-04 | Is the El Paso client entering buildings into the same company that still holds the demo portfolio (Truman, Ysleta) and the "Testing" property? If yes: may we delete every demo and test row from that company before November billing, after a database backup? | **Yes, purge after backup.** Otherwise Generate bills fake leases and Reports mix fake money with real. |
| 2 | A-03, B-19, A-05/B-03 | When a lease passes its end date and nobody has recorded a move-out, what should the system do: (1) mark it Ended automatically, or (2) mark it "Month-to-month" and keep billing until a move-out is recorded? And on Renew, should the old lease be closed on its end date automatically? | **(2) month-to-month, keep billing; and yes, auto-close the old lease on the day the renewal starts.** Texas practice is holdover = month-to-month; auto-ending would silently stop invoicing a paying tenant. |
| 3 | A-04 | Should rent receipts be generated automatically on the 1st of each month (as drafts the manager reviews before sending), or stay a manual button? | **Automatic drafts on the 1st, manual send.** The button stays for catch-up. Needs the A-02 filter first. |
| 4 | A-13/B-10, tester M#12 | On move-out, should the lease's end date be overwritten with the surrender date, or stay the contract date with the surrender date shown next to it? | **Keep the contract date; show "Moved out 10/26" next to it.** The contract date is a legal fact; the surrender date is already stored. |
| 5 | A-16/B-20 | Should the dashboard's "Collected this month" mean (1) money received this month, whatever it paid for, or (2) money received against this month's rent? | **(1) cash received**, matching Reports. Label it "Received in October". |
| 6 | A-17 | Should a work order's cost count as an expense in Reports automatically? Risk: staff also enter the vendor bill under Expenses and it counts twice. | **Yes, as its own "Maintenance" line in Reports (no copy into Expenses).** Tell staff not to re-enter vendor bills. |
| 7 | A-18 | Should late fees be applied automatically once the grace period passes, or stay a manual click per receipt? | **Manual for the first client's first two months.** Automatic later, once the lease clause and tenant notice wording are confirmed. |
| 8 | A-15 | Should a guarantor (co-signer) who gets a portal login be able to see the tenant's invoices, payments and repair requests and report payments? | **No.** Exclude guarantors from `my_lease_ids()` until a guarantor view is designed. |
| 9 | A-07 | Each client company needs its own "Request access" link (`rentio-app.com/request-access?org=<company>`) until each has its own domain. OK to hand out per-company links for now? | **Yes, per-company link now;** hostname → company when custom domains are set up. |
| 10 | B-07, tester C#1 | Switch Clerk to a production instance for rentio-app.com and confirm both keys come from that one instance. | **Yes, this week.** Owner creates the instance and keys; we deploy. |
| 11 | B-15, B-23, TRD §8.12 | May Parking, Services, Access requests and Import appear in the sidebar? | **Parking and Access requests yes** (daily use); Services and Import stay URL-only. |
| 12 | B-12 | A property with leases, payments or expenses: block deletion with a message, or add an "Archive" state? | **Block with a message for now;** archive later if a client asks. |
| 13 | B-16, tester M#9 | Which editing functions first: unit edit + status (Maintenance/Reserved), tenant edit, work-order fields, or deletes? | **Unit edit+status, then tenant edit, then work-order priority/category/H&S.** No deletes for records with history. |
| 14 | B-17, tester M#11 | A receipt, notice or deposit letter downloaded by staff: in the tenant's language or the staff member's screen language? | **Tenant's language, default Spanish;** staff exports (CSV) in the screen language. Add the English receipt (known B-009) as the next PDF task. |
| 15 | B-34 | Should expenses be allowed at property level (taxes, insurance) with optional unit and a category list? | **Yes** (nullable `unit_id` + `property_id` + a short category enum). Not in the next 2 weeks unless the client asks. |
| 16 | B-14 | Do you want a "Revoke portal access" button on a tenant? | **Not yet.** Disable via Settings → Users suffices. |

## Agent grades

### QA-A (backend, data, money)

- **Precision:** 25/25 confirmed (0 rejected, 0 unsure). Every SQL and code claim reproduced by reading; A-24's two parse claims reproduced in bun. Several findings had deeper root causes than the tester's (C#5, M#2, M#6) and all three held up.
- **Smallest-fix quality:** mostly right and correctly placed in shared code (A-02 filter + test, A-06 one helper for three call sites, A-14 derive-from-dates, A-12 disable-until-saved over client-supplied data). Not smallest or risky: A-05's `btree_gist` exclusion constraint cannot be applied to the live DB as it stands (V-04) and is bigger than the start-date fix; A-03/A-04/A-18 each propose a nightly SQL job, which is the right destination but not a 2-week change; A-01's own fix list matched what was shipped.
- **Coverage gaps:** did not notice the test/demo rows sitting in the production company (V-04), nor that `/sign-in` reaches `/request-access` without a slug (A-07's own fix leaves that hole). Did not read the front-end error path at all (fine, out of scope) but reported "late fee guard uses UTC" without noting the guard's errcode makes its message unreachable in the UI (V-03).
- **Grade: A.** The one list I would ship from as-is, with A-05's constraint deferred.

### QA-B (frontend, flows, UX)

- **Precision:** 33/34 confirmed; B-07 UNSURE (real warning, diagnosis skips Clerk's own "keys do not match" sentence). One overstated detail inside B-17 (utility labels, moot). One wrong option offered inside B-13 (client-sent deductions). Verified B-01 and B-02 against library source; both exact.
- **Smallest-fix quality:** good and concrete; the working tree implemented B-02 (singleton + optimistic patch), B-05/B-06, B-08, B-11, B-14, B-21, B-22, B-26, B-32, B-33 almost verbatim and they are correct. B-10's SQL function is bigger than needed for now; the 4-line client guard that landed is the right interim. B-27's "lift the search" and B-12's "count leases before confirming" are correctly sized.
- **Coverage gaps:** missed the portal's role-blind lease pick (`useMyPortal`, found by A), the CSV importer entirely (A-14/A-24), and that `describeError` results go through `t()` (so raw messages need the namespace separator handled). Listed the maintenance board cards under B-21 but the fix note only covered `DataTable`. Did not flag the production demo data either.
- **Grade: A-.** Broadest and most actionable list; one diagnosis (B-07) should have quoted the library before theorising.

### Both

Neither looked at `supabase/setup.sql` generation (V-01) or at the locale *values* beyond key parity (V-02). Both cross-checked the tester's report carefully and corrected five of its root causes; neither reported a tester item as wrong, and on reading I agree with all their cross-check verdicts.
