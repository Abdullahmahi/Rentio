# Reports: session log

> Append one entry at the end of every session, newest first. This is the
> memory between sessions: the next one starts by reading the top entry.
> Report what happened, including failures and anything skipped. A check you
> didn't run is "not run", never "passed".

## Template

```markdown
## YYYY-MM-DD · <task from task_today.md>
**Outcome:** done / partial / blocked, in one line
**Changed:** `path` (what and why), one bullet per file
**Checks:** G1 … G8 from testing.md, with the actual result; manual cases run (ids) with pass/fail
**Decisions:** what was chosen and why, and anything the owner must confirm
**Found:** new bug / security ids opened
**Next:** the single most useful next task
```

---

## 2026-10-21 · Project docs and baseline audit

**Outcome:** done. The doc set is in place, and the baseline audit found three P0 security issues that block phase 1.

**Changed**
- `docs/PRD.md`: new v2.0 for El Paso, which replaces the Mexico-era `../PRD.md`.
- `docs/TRD.md`: the architecture as built, 13 invariants, and the next-phase deltas.
- `docs/audit.md`: the audit protocol plus Audit 0 (baseline).
- `docs/bugs.md`: the protocol plus B-001 to B-017.
- `docs/security.md` (**gitignored**): S-001 to S-010.
- `docs/testing.md`: gates and QA cases by area.
- `docs/task_today.md`: a blank template.
- `docs/reports.md`: this file.
- `AGENTS.md`: a docs table and the session loop.
- `CLAUDE.md`: `@AGENTS.md`, so Claude Code loads it.
- `.gitignore`: ignores `docs/security.md`.
- No application code changed.

**Checks**

| Check | Result |
|---|---|
| G1 | 52 pass |
| G2 | clean |
| G3 | 0 errors / 12 warnings |
| G4 | built |
| G5 | **not run**. `db.<ref>.supabase.co` does not resolve here (IPv6-only); switch `DATABASE_URL` to the session pooler |
| Anon read of `public_settings` | 200 with data, so S-010 is confirmed |

Manual cases: none run.

**Decisions**
- The docs live in `docs/` next to the existing spec.
- `task_today.md` is reset with `git checkout`, not deleted, so the template survives.
- Security details are kept out of the public repo.
- Owner to confirm:
  - Should the Reports CSV export come back?
  - May managers reject reported payments (B-014)?
  - Are utilities gone for good?
  - Written approval of the multi-tenant spec.

**Found:** S-001 to S-010, B-001 to B-017 (all from reading the code; B-003 contradicts SETUP.md and needs a repro).

**Next:** fix S-001 and S-002. One `BEFORE UPDATE`/`INSERT` trigger on `profiles` stops anyone but an admin changing `role` or `tenant_id`, with RLS-suite assertions. Then rotate the demo passwords (S-003).

## 2026-10-24 · Off Supabase: PostgREST + Clerk + multi-tenancy

Implements `../RENTIO_MIGRATION_SPEC.md` phases 1–3. Chosen with the owner: **self-hosted PostgREST instead of a Fastify API** (the 142 `.from()` calls and all RLS stay as they are), and that spec wins over `superpowers/specs/2026-10-10-…` where they conflict.

**Changed**
- `20261024001300_super_admin_role.sql`, `20261024001400_self_hosted_multi_tenant.sql`: PostgREST roles (`anon`, `authenticated`, `service_role`, `authenticator`); `current_user_id()` / `current_org_id()` from JWT claims; `organizations`; `org_id` + index on 22 tables, backfilled to one org; `org_from_parent` trigger; one RESTRICTIVE `org_isolation` policy per table; settings per org; invoice numbers unique per org; `profiles.clerk_user_id` + `email`; `profiles_restrict_role_changes` trigger. Fixed two cross-org leaks in the security-definer views `my_lease_details` and `public_settings`.
- App server: `src/lib/server/` (session/JWT, storage, email, invoice PDF, invite), `src/routes/rest.v1.$.ts` (PostgREST proxy), `api.me.ts`, `api.storage.$action.ts`, `api.files.$.ts`, and 7 `api.fn.*` routes replacing the edge functions. `tenant-self-enroll` dropped: Clerk sign-up + verified-email match does the same job.
- Browser: `src/lib/supabase.ts` → `src/lib/db.ts` (postgrest-js); `storage.ts` and `auth.tsx` on the new routes and Clerk; sign-in/sign-up/activate use Clerk components; forgot/reset password redirect to sign-in.
- Removed `@supabase/supabase-js`, `supabase/functions/`, `vercel.json`, `seed_auth.sql`, `oauth-buttons.tsx`, `auth-providers.ts`. Added `Dockerfile`, `.dockerignore`. Rewrote `.env.example`, `SETUP.md`, TRD §1/3/5/6/11, `seed-demo-logins.ts` (Clerk). `seed.sql` now touches only the first org.

**Checks**

| Check | Result |
|---|---|
| G1 | 52 pass |
| G2 | clean |
| G3 | 0 errors / 13 warnings (one new, same fast-refresh pattern in `auth.tsx`) |
| G4 | built; Docker image built and served `/`, `/sign-in` 200, `/rest/v1/*` 401 |
| G5 | all pass, on a local Postgres 17 built from the migrations + seed, on a fresh DB from `setup.sql`, and after a reseed. New: 25 cross-org and role assertions (spec §6 step 5) |
| PostgREST end to end | 12/12: anon and forged tokens refused, admin/tenant scoping, org defaults, child trigger, RPC, embeds, count headers |
| App server over HTTP | proxy 401 without session, cross-site POST 403, access request stored in the right org, signed file 200, tampered link 403, path traversal refused |

Not run: anything needing a real Clerk instance (sign-in, first-login linking, invites end to end). Manual cases: none.

**Security:** closes S-001, S-002, S-005, S-010.

**Next (owner):** create the Clerk app; deploy PostgREST + app in Coolify per `SETUP.md` §5; run the two migrations on `rentio-db`; then the spec §6 cutover (sign in as each role, then the cross-org test against production).

## 2026-10-27 · QA pass, super_admin acting-in-company, demo data wipe

Owner reported "New property" failing. Root causes: a super_admin has no org (org_id NULL on insert) and blank ZIP sent as "" (check constraint). Ran a 3-agent QA (two reviewers, one verifier; `docs/qa/`), a design review (`../suggestions.md`) and wrote `../plan.md`.

**Changed** (commits 8e8be01, 47a5461)
- `20261027001500_super_admin_acts_in_org.sql`: read/write RLS split per table (platform view read-only), `is_super_admin()` requires `org_id IS NULL`, role trigger refuses `super_admin`/org moves below platform staff (A-01), settings row per new org (A-08), `my_lease_details` tenant branch pinned to org (A-22).
- `/api/org` + `ACTING_ORG_COOKIE` in `session.ts`, `org-switcher.tsx`, acting bar in `app-shell.tsx`.
- `blankToNull` in property and settings forms; `describeError` by Postgres code; session cache not storing null profiles and dropped on profile PATCH; invite no longer demotes staff; `?org=` on request-access; safe receipt file names; Origin/derivedKey fail closed.
- Frontend: `currentLeaseFor`/`currentLeaseByTenant` (A-06/B-04); renew start date; move-out vacancy guard; sign-in pending/suspended/failed states and the `?redirect=/sign-in` loop; language toggle via i18n singleton + `patchProfile`; invite-pending badge + resend; dashboard links; keyboard rows; a11y; H&S badge; import parsing and status; El Paso dates in `texas.ts` and the disposition route.
- Production: migration applied (snapshot `/root/rentio_before_20261027.sql`), demo + "Testing" data removed (snapshot `/root/rentio_before_wipe_20261027.sql`), today's real entries kept (5 properties, 8 units, 8 tenants, 10 leases, 3 profiles).

**Checks**

| Check | Result |
|---|---|
| G1 | 55 pass (+3: lease ranking, import comma/date) |
| G2 | clean |
| G3 | 0 errors / 13 warnings |
| G4 | built; deployed twice, `/sign-in` 200 |
| G5 | 70 assertions pass on the migrated local DB and on a fresh `setup.sql` DB. On production the suite stops at `admin reads properties = 3` (it assumes seed data); migration verified structurally there (88 org policies, `is_super_admin` fixed, settings trigger present) |

Not run: anything needing a live Clerk session (browser was signed out), so the super_admin switcher, the sign-in states and the ES/EN toggle are verified by code and tests only.

**Open:** D1–D14 in `../plan.md`. Still-untouched QA items: nightly job (A-02/03/04/18), move-out SQL function (A-13), collected definition (A-16), WO cost → expenses (A-17), guarantor portal (A-15), missing edit/delete (B-16), Spanish-only PDFs/CSV (B-17), expenses per unit (B-34), board property name (B-25), empty-state buttons (B-31), payment error clearing (B-28), grid search (B-27), `my_lease_details` seed-data suite on prod.

## 2026-10-27 — live QA on production (QA Sandbox)

Clicked through every staff feature on rentio-app.com. Fixed 11 bugs (docs/qa/live-qa-2026-10-27.md):
money inputs ate the decimal point, UTC dates in Postgres (migration 20261027001600 applied),
receipts due before move-in, drafts not payable, disposition letter unreachable after settling,
Spanish defaults on legal PDFs, 3-day end-of-term notices, tenant access to company files,
$1,200 parking default. Gates: tsc clean, eslint clean, 58 tests pass. Six owner decisions listed.

## 2026-10-28 · Harbor palette + palette picker; offer-led homepage

**Changed**
- `src/styles.css`: Harbor (harbor blue `#1f4e79` on fog `#f6f8fa`) replaces Evergreen in `:root` and `.dark`. Mesa, Juniper and Graphite added as `:root[data-palette]` / `:root.dark[data-palette]` overrides. `--accent` is now shadcn's hover tint instead of terracotta. Semantic tones and chart fills unchanged.
- `src/lib/palette.ts` (new): palette list, `applyPalette`, and an inline pre-paint script (also fixes the dark-mode flash, suggestions §2.6). Wired in `src/routes/__root.tsx`.
- Settings > Preferences: colour palette picker (radio group with swatches). New strings `theme.palette.*` in en + es-MX.
- Homepage rebuilt as an offer (`OFFER.md` at the folder root): new Problem, AI layer, Offer (value stack, price card, 30-day guarantee) and FAQ sections; hero and CTA copy rewritten; nav updated. `PRICE` in `offer.tsx` is `null` until the owner sets it.

**Checks**: `bunx tsc --noEmit` clean · `bun test` 61 pass (new `palette.test.ts` keeps the CSS and picker in sync) · `bunx eslint .` 0 errors · `vite build` OK. Contrast measured for all four palettes, light and dark: every text pair >= 4.5:1 (lowest 4.88, Juniper muted text on muted).

**Not verified**: the page was not viewed in a browser; local `bun run dev` fails on a missing Clerk secret key in `.env.local`.

**Blocking before deploy**: the AI section promises a 24/7 AI phone line, missed-call text-back, AI reminders and drafted replies. None exist in the product yet (`ai-layer.tsx` says so). The guarantee and price need the owner's approval.

## 2026-10-28 · Post-booking page `/booked` (the VSL)

**Changed**
- `src/routes/booked.tsx` (new): where Cal.com redirects after a booking; reads `?name=` for the headline; `noindex`. `public/robots.txt` disallows it.
- `src/components/marketing/booked-page.tsx` (new): hero with the co-founders' video (placeholder until `BOOKED_VIDEO_URL` in `src/lib/marketing.ts` is set), three things before the call, the 30-minute agenda, a before/after Tuesday, the 30-day done-for-you timeline, the homepage's offer card without its booking button, a testimonial section that stays hidden until `TESTIMONIALS` has a real quote, the FAQ, and a closing with no booking CTA.
- `offer.tsx`: optional `cta` prop (`null` hides the button). `marketing.en.json`: `booked.*` strings.
- `../VSL.md` (folder root): the video script, the Hormozi rationale per section, the page copy, the quote request for Hayen, and the owner steps (Cal.com redirect + forward parameters, record the video).

**Checks**: `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors · `bun test` 61 pass · `vite build` OK · `vite preview` returns 500 on `/` and `/booked` alike (server env not set locally), so the page was not rendered.

**Not verified**: not viewed in a browser (same Clerk `.env.local` gap as the homepage).

**Blocking before deploy**: same as the homepage. The reused offer card lists the AI line and automations, which do not exist yet (`OFFER.md` §13); the guarantee wording is still an owner decision.

## 2026-10-28 · `/booked` becomes `/vsl`, connected to Cal.com bookings

**Changed**
- Route renamed `/booked` → `/vsl` (`src/routes/vsl.tsx`, `src/components/marketing/vsl-page.tsx`); `robots.txt` updated.
- Bookings now land on it: `BookingLink` opens Cal.com's popup on our page (`data-cal-link`, namespace `rentio`) and `loadCalEmbed` in `src/lib/marketing.ts` sends the visitor to `/vsl` on `bookingSuccessfulV2`. Without JS, or with embed.js blocked, the button still opens cal.com in a new tab.
- Page: EN/ES toggle in the header; the empty testimonial section removed (owner rule: `CLIENT_PROOF` only) and the proof line shown under the video; `booked.proof` strings dropped from both locales.
- Video script restored as `../VSL_POST_BOOKING.md` (`../VSL.md` is now the homepage script).
- New test `src/lib/marketing-cal.test.ts` for `calLinkFor`.

**Checks**: `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors · `bun test` 67 pass · `vite build` OK. Chrome, on a scratch page bundling the same loader: popup opens with the Rentio Partner Meeting calendar, no new tab; a simulated `bookingSuccessfulV2` message navigated to `/vsl`. No real booking made.

**Not verified**: `/vsl` itself in a browser (no Clerk keys in `.env.local`, so SSR returns 500 locally on every route).

**Owner**: Cal.com "redirect on booking" → `https://rentio-app.com/vsl` with forward parameters, for bookings made on cal.com directly.

## 2026-10-28 · FAQ page

**Changed**
- New `/faq` route (`src/routes/faq.tsx`) with all 16 questions; the home page shows the first five (cost, switching, hidden fees, contract, AI) plus a "See all 16 questions" button. `Faq` takes `full`.
- New owner-supplied answers: setup fee, hidden fees, 6-month minimum, live in 3–5 business days, we migrate, frees staff, after-hours line, tracing money / owner report, tenant portal. EN + es-MX.
- 6-month minimum made consistent: offer card's "No lock-in / Leave any month" → "Easy to leave / After the first 6 months…", and the `data` answer.
- `/faq` added to `sitemap.xml`.
- Owner decision, same day: sell the roadmap features too. Offer card has a new "Money and owners" group (online rent by card/ACH/PayNearMe, owner portal, owner statements, QuickBooks sync), all badged "Done for you", never "Live today". FAQ gained `ownerPortal`, `quickbooks`, `payMethods`; `fees` restored (dropped by mistake earlier); the payments feature card and offer item mention card/ACH. FAQ is now 20 questions.
- None of the four exist in code yet. Build them when a client needs them.

**Checks**: `bunx tsc --noEmit` clean · eslint clean on touched files · prettier clean · `bun test` 67 pass · `vite build` OK.

**Not verified**: in a browser (no Clerk secret locally, SSR 500s).

## 2026-11-11 · P0 fixes from the product audit (tenant money + bulk send)

Source: `../audit-product-2026-10-28.md` §1.

**Changed**
- Tenants no longer see draft invoices. New migration `20261111000100_tenants_cannot_read_drafts.sql` rewrites `invoices_select` so a tenant reads only `status <> 'borrador'`. `lease_balances` and `invoice_balances` are `security_invoker`, so the tenant's balance and "Due on" drop drafts with no client change. Staff unaffected.
- Portal "Due on" now picks the **oldest** unpaid invoice (`portal.index.tsx`); the list is newest-first, so it used to hide an older overdue one.
- Bulk "Send all / Send selected" now actually emails. `sendSelected` in `app.receipts.index.tsx` calls `send-invoice-email` per invoice (same path as the single Send, which also flips the status to `enviado`), falls back to a status update for any that failed, logs `emailed` in the activity row, and shows the existing `receipts.sentWithoutEmail` warning if any didn't go out. Sequential; batch it if 400+ doors makes it slow.
- RLS test: seeds a `borrador` invoice on tenant A's lease as admin, then asserts the tenant can't read it.
- `setup.sql` regenerated (21 migrations + seed).

**Checks**: `bun test` 67 pass · `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors (13 warnings, none in touched files) · `vite build` OK · `bun run db:setup` regenerated · G5 on a throwaway `postgres:17` container (shim → setup.sql → rls_test): new assertion `ok tenant cannot read own draft invoices`, no ERROR under `ON_ERROR_STOP`; container removed.

**Not verified**: in a browser (no Clerk keys locally). `db:types` skipped — a policy change doesn't alter the generated types. Working tree already held uncommitted changes in `app.receipts.index.tsx`, `rls_test.sql`, `setup.sql` and an untracked `20261028002300_record_and_void_payment.sql`; this session's edits sit on top of them. Nothing committed.

**Next from the audit**: lease wizard transaction + co-tenant/guarantor exclusivity; acting-org cookie cleared on sign-out + no auto-act; last-admin guard on role change; `activity_log` read-only for staff.

## 2026-11-11 · Remaining P0s from the product audit (lease, acting org, last admin, audit log)

Source: `../audit-product-2026-10-28.md` §1. All nine P0 rows are now closed.

**Changed**
- **Lease creation is one transaction.** New `create_lease(p_unit, p_terms, p_primary, p_co_tenants, p_guarantors, p_checklist)` RPC (`20261111000200_create_lease.sql`): lease + `lease_tenants` + turnover checklist + unit `ocupada`, staff-only, unit must be in the caller's org, refuses a missing party and one person in two roles. The wizard (`lease-wizard.tsx`) calls it; the contract PDF upload and the activity row stay in the browser after it. Typed by hand in `database.types.ts` (`db:types` needs a DB).
- Wizard pickers: a co-tenant can't also be picked as guarantor and vice-versa; the chip shows "Unknown tenant" (`contracts.unknownTenant`, EN+ES) instead of a raw UUID; an empty inline-tenant name shows the field error instead of silently doing nothing.
- **Acting-org cookie** (`api.org.ts`): now a session cookie (no `Max-Age`), and a `DELETE /api/org` clears it; `signOut` in `auth.tsx` calls it before Clerk signs out. `actingOrgFor` (`session.ts`) no longer auto-picks the only company: acting is always an explicit switcher choice, so super admins land in the read-only platform view until they pick one.
- **Last-admin guard** (`20261111000300_last_admin_and_append_only_log.sql`): `profiles_zz_keep_one_admin` BEFORE UPDATE trigger refuses demoting a company's last admin (named to fire after `profiles_restrict_role_changes`, so a privilege refusal wins). Settings → Users: your own role Select is disabled with a title hint (`settings.ownRoleLocked`, EN+ES).
- **Audit log append-only**: `staff_update` and `admin_delete` dropped on `activity_log`.
- RLS test: 13 new assertions (last admin ×4, audit log ×2, create_lease ×7). Found and fixed two real bugs on the way: the role literals in `create_lease` needed the enum cast; and new blocks must `set local role authenticated` (after line 325 the file runs as superuser, which also explained a one-in-nine flake where a superuser-visible org-B unit sorted first).
- `setup.sql` regenerated (23 migrations + seed).

**Checks**: `bun test` 67 pass · `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors (13 known warnings) · `vite build` OK · `db:setup` regenerated · G5 on a throwaway `postgres:17` (shim → setup.sql → rls_test): **126 ok, 0 errors, 5/5 runs**; `lifecycle_test.sql` 0 errors; container removed.

**Not verified**: in a browser (no Clerk keys locally): the disabled own-role Select, the sign-out → DELETE call, and the wizard end to end. `db:types` not regenerated (hand-edited for `create_lease`; a policy/trigger change doesn't alter types). Working tree still holds earlier uncommitted work; nothing committed.

**Owner decision**: with no auto-act, an existing super admin signs in to the platform view and must pick the company once. Say if you'd rather keep the one-company shortcut.

## 2026-11-12 · Tenants hear back: notifications outbox + rejection reason in the portal

Source: `../audit-product-2026-10-28.md` §2.1 #8, §2.2 #6, §6 step 2. Backend and emails only; the in-app notifications list is a new portal screen and waits for Paper (`design-in-paper-before-code`).

**Changed**
- `20261112000100_notifications.sql`: `public.notifications` outbox (org, tenant, lease, kind, payload, `dedupe_key`, `sent_at`, `channel` email|portal, `read_at`). RLS: tenants read their own and may update only `read_at` (column grant), staff read their company's, org-isolation restrictive policies; rows are written only by triggers and the server. Triggers queue one row per tenant party (guarantors excluded) on: a tenant-reported payment confirmed or refused (reason rides in the payload), a repair request's status change, a tenant-visible note. `queue_rent_reminders()`: open sent invoices due within 3 days, once per invoice and tenant. `claim_notifications(limit)` claims (`for update skip locked`) and returns what to email; `notification_result(id, channel)` records email/portal or releases on failure.
- `src/lib/server/notification-email.ts`: five templates, EN + es-MX by the tenant's portal locale (Spanish when unknown), names escaped, "no fee to pay rent" line on the reminder. `src/lib/server/notifications.ts`: `drainNotifications()` shared by the new staff route `POST /api/fn/send-notifications` and the nightly job (which now also calls `queue_rent_reminders`). No new cron: staff actions drain within seconds, nightly is the backstop.
- Client: confirm/refuse payment and repair status change/note call `send-notifications` fire-and-forget on success. The note composer now resets to internal after each note (audit §3.2 #7).
- Portal home: the balance card says when the newest reported payment was refused and why (`portal.paymentRejected`, `portal.rejectedReason`, EN+ES); the activity list shows the reason under "Cancelled".
- Tests: 10 RLS assertions (refusal queues + carries reason, status change queues, tenant reads own / marks read / cannot touch delivery columns, other tenant blocked, reminders idempotent, claim marks sent, release works); `notification-email.test.ts` covers all five kinds in both languages, escaping, locale fallback, unknown kind. The last-admin block now restores roles so later blocks start clean.
- `SETUP.md` nightly-job note updated. `setup.sql` regenerated (24 migrations + seed). Route tree regenerated by the build.

**Checks**: `bun test` 74 pass · `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors (13 known warnings) · prettier clean · `vite build` OK · G5 on a throwaway `postgres:17`: **136 ok, 0 errors, 3/3 runs**; `lifecycle_test.sql` 0 errors; container removed.

**Not verified**: a real email send (no `RESEND_API_KEY` locally; the drain path is exercised in SQL and the templates in bun, not against Resend); the portal copy in a browser. `db:types` hand-edited for the three RPCs. Nothing committed.

**Open from this slice**: the in-app list (Paper first) is what closes "late-fee warnings for tenants without email go nowhere" and makes `channel = 'portal'` rows visible; `send-notifications` drains every company's pending rows, not only the caller's (harmless, noted in the route).

## 2026-11-12 · Tenant P1 bugs and staff quick wins (no design changes)

Source: `../audit-product-2026-10-28.md` §2.2, §3.1, §3.2. Everything here fits the existing screens.

**Tenant**
- Repair request retry no longer files a duplicate: the request id and photo progress are kept in state, so a failed photo upload resumes on that request. Photo-insert errors are now checked (`portal.maintenance.index.tsx`).
- `setState` during render replaced by an effect in report-payment (RP3).
- PDF download works on iOS: new `src/lib/open-after.ts` opens the tab synchronously and fills in the signed URL after the await; used by the portal and staff receipt pages.
- Request detail shows notes/photo load errors instead of "No updates"; photos have alt text; Back link is 44px.
- Receipt cards: chevron instead of a Download icon on a button that navigates.
- Shell: bottom bar padded for the iPhone home indicator, prefix matching so detail pages keep their tab lit, 12px labels, `aria-current`, bold+thicker icon on the active tab. Browser tab title says "— {landlord}" instead of "— Rentio" (`useCompanyTabTitle`, MutationObserver on `<title>`).
- `useMyPortal` never falls back to a lease the person only guarantees (A-06); guarantor-only people get the "no lease" state.
- Sign out is neutral, not red. Payment methods ordered Zelle, cash, money order, check, ACH with Zelle default (**owner to confirm**). Copy: double ✓ removed, "Money order" → "Giro postal".

**Staff**
- Bulk "Send all N" / "Send selected" now confirm with count and total (M4) — it matters since bulk send actually emails as of 2026-11-11.
- H&S work orders reported by phone can start the §92.056 clock: "Written notice received today" button on the detail page sets `written_notice_at` and logs it (portal requests still set it automatically).
- Renew is hidden on terminated/rescinded leases (C4).
- Tables: 25 rows per page by default, pagination hidden when there is one page (T4).
- Dashboard "Collected" says "This month's invoices haven't been generated yet" instead of "$0 of $0" (D7).
- Sidebar trigger's label says collapse or expand depending on state.

**Checks**: `bun test` 74 pass · `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors · prettier clean · `vite build` OK. No migration in this slice, so no G5 run.

**Not verified**: in a browser (375px layout, safe-area, the title swap, iOS Safari). Nothing committed.

## 2026-11-12 · Second batch: staff lists, nightly isolation, impersonation audit, shared photo picker

Source: `../audit-product-2026-10-28.md` §3.1 (M2, W3, D4, N5), §3.2 #13, §4.2 #3, §4.3; `suggestions.md` SR3.

**Changed**
- Payments: the queue/history tab is chosen once on first load, not on every refetch (M2 — it used to flip to History under the manager's hands mid-review).
- Maintenance board cards show "Property · Unit 104", not just the unit (W3).
- Dashboard "Recent payments" rows show tenant · unit, with the method on the second line (D4).
- Tenants list: property filter next to the lease filter (§3.2 #13).
- Tenant detail: "Role on the lease" row, plus an "Other leases" list with each lease's role and status (N5). New `tenants.leaseRole.*` labels EN+ES.
- `20261112000200_nightly_per_org.sql`: `nightly()` runs each company in its own sub-transaction; a failure is logged as a warning and returned as `orgs_failed` instead of aborting every company's invoicing (§4.3). `setup.sql` regenerated (25 migrations + seed).
- `/api/org` writes an `activity_log` row (`act_in_org` / `leave_org`, actor, from → to) whenever a super admin switches company (§4.2 #3).
- New `PhotoPicker` (`src/components/rentio/photo-picker.tsx`): camera-first dropzone with thumbnails and 44px remove buttons; used by report-payment (single) and new-request (multiple), replacing the bare file input (SR3). `actions.remove`, `portal.addAnotherPhoto` EN+ES.

**Checks**: `bun test` 74 pass · `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors · prettier clean · `vite build` OK · G5 on a throwaway `postgres:17`: rls 136 ok / 0 errors, lifecycle 38 ok / 0 errors ("second nightly() changes nothing" still holds); container removed.

**Not verified**: in a browser; a real org failure inside `nightly()` (the sub-transaction path is exercised only by the happy-path lifecycle test). Nothing committed.

## 2026-11-12 · Third batch: language gaps and the late-fee default warning

Source: `../audit-product-2026-10-28.md` §2.1 #5, #8, #11; §4.4; §3.2 #12. "Every document in the tenant's language" is the positioning (research §2).

**Changed**
- Receipt email (`api.fn.send-invoice-email.ts`) is now in the tenant's portal language (Spanish when none saved): EN subject, body and table labels added; `emailLayout` gets the `lang`.
- Receipt PDF footer is bilingual like the rest of the labels (`invoice-pdf.ts`).
- Staff invite email is bilingual, English above / Spanish below, same pattern as the tenant invite (`invite.ts`); role names translated.
- Settings → Invoicing: the company default late-fee % shows a field error above the Texas 12% ceiling, naming both caps (`settings.fields.lateFeePercentOverCap` EN+ES). The wizard still refuses per lease.

**Left alone on purpose**: the deposit disposition letter still defaults to **English** when the tenant has no saved language. The code gives a legal reason ("a Texas legal notice"), which contradicts the Spanish-default decision elsewhere — **owner to decide**; a one-line change either way (`api.fn.generate-deposit-disposition.ts:127`).

**Checks**: `bun test` 74 pass · `bunx tsc --noEmit` clean · `bunx eslint .` 0 errors · prettier clean · `vite build` OK · both locale files parse. No migration in this slice.

**Not verified**: a real send (no Resend key locally). Nothing committed.

**Owner questions from today**: (1) deposit letter default language, above; (2) portal payment-method order now Zelle · cash · money order · check · ACH with Zelle preselected (research §3, El Paso) — confirm or reorder in `portal.report-payment.tsx:25`.
