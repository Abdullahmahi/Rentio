# Audit: code vs plan

> Run this at the end of **every phase** (multi-tenant spec §11 has five) and
> whenever the plan changes. Read the plan, then read the code. Don't trust
> commit messages or earlier reports. Each finding names a file. A finding
> that is a bug goes into `bugs.md` (or `security.md`) and is referenced here
> by id. Append a new audit at the top of the log; never edit old ones.

## How to run one

1. **Plan:** list every deliverable of the phase from the spec, `PRD.md` and `TRD.md`.
2. **Code:** for each deliverable, find where it lives (`path:line`). If you can't find it, it's a **gap**.
3. **Correctness:** walk the deliverable's code path end to end. Anything that contradicts the plan, a TRD invariant, or its own comments is a **mistake**.
4. **Orphans:** files, routes, exports, columns, locale keys or dependencies that nothing uses or reaches. Check with `grep`, don't guess. List them; delete only with the owner's OK (hidden routes are deliberate, PRD §4.2).
5. **Doc drift:** places where README, SETUP, TRD or PRD say something the code doesn't do. Fix the doc in the same pass.
6. **Gates:** run `testing.md` §1 and paste the results.
7. **Verdict:** **pass** (next phase may start), **pass with follow-ups** (follow-ups have bug ids), or **fail** (name what blocks).

## Template

```markdown
## Audit N · <phase name> · YYYY-MM-DD
**Plan source:** <spec § / PRD § / TRD §> · **Commit:** <hash>
**Gates:** G1 … G8 results

| Deliverable | Where it lives | Status |
|---|---|---|
| … | `path:line` | done / partial / missing |

**Gaps:** …
**Mistakes:** … (bug ids)
**Orphans:** …
**Doc drift:** … (fixed in this pass? yes/no)
**Verdict:** pass / pass with follow-ups / fail, because …
```

---

# Log

## Audit 0 · Baseline before the multi-tenant phases · 2026-10-21

**Plan source:** PRD v2.0, TRD v1.0, multi-tenant spec (2026-10-10) · **Commit:** `4fe1b62` (plus uncommitted docs)

**Gates**

| Gate | Result |
|---|---|
| G1 `bun test` | ✅ 52 pass, 0 fail, 204 expects |
| G2 `tsc --noEmit` | ✅ clean |
| G3 `eslint .` | ✅ 0 errors, 12 warnings (all `react-refresh/only-export-components`) |
| G4 `bun run build` | ✅ built |
| G5 RLS suite | ⛔ **not run.** The direct DB host doesn't resolve from this machine (IPv6-only). See TRD §9 |
| G6 `setup.sql` | ✅ in sync (13 migrations + seed) |

**Plan status**

| Deliverable | Status |
|---|---|
| v1 staff portal (PRD §4.1), nine nav items | ✅ present (`nav-items.tsx:20-42`) |
| Hidden routes (PRD §4.2) | ✅ deployed and reachable as described |
| Tenant portal (PRD §4.3) | ✅ present. Report-payment proof is lost (B-012) |
| Texas rules (PRD §4.5) | ✅ in code and DB. The DB late-fee date uses UTC (B-004) |
| Reports CSV export (v1 PRD) | ❌ removed in the scope trim `326123f`. Owner to confirm that's intended |
| Multi-tenant phase 1–5 | ❌ not started: no `organizations`, no `org_id`, no Stripe code. Spec status "awaiting written review" → **needs the owner's written sign-off before phase 1** |
| `confirm_payment()` in SQL (spec §7) | ❌ allocation still in the browser (B-013) |

**Mistakes:** listed in `bugs.md` and `security.md`. Three P0s must be fixed
**before phase 1**: S-001 and S-002 (role escalation through `profiles`) and
S-003 (demo admin password, public, works on the live project).

**Orphans** (confirmed by grep; delete only with the owner's OK)

| Orphan | Where | Suggestion |
|---|---|---|
| Unused component | `src/components/rentio/placeholder-page.tsx` | delete |
| Route with no link | `src/routes/signup.tsx` (`/activate` and `/request-access` cover it) | delete or link it |
| Unreachable utility billing | `src/lib/invoicing.ts:64-74,104-146` (still tested) and the Servicios copy saying charges are "pulled into receipts" (`app.services.index.tsx:400`, `en.json:974`) | fix the copy now; drop the code path if the owner confirms utilities are gone for good |
| Unused exports | `toE164` (`us.ts`), `BRAND_TAGLINE` (`brand.ts`), `isManager` (`auth.tsx`), `needsAttention` (`deposit.ts`), `DEFAULT_VACATE_NOTICE_DAYS` (tests only) | delete |
| Unused locale keys | `user.name` ("Mariana Torres"), `user.role`, `user.initials` | delete from both locales |
| Unused dependencies | `zod`, `date-fns`, `@hookform/resolvers` | remove one at a time and run G4 after each; app-level zod 3 already collided with the start plugin's zod 4 once (`fc31084`) |
| Unused schema | `deposit_obligations` view, `leases.deposit_notes`; legacy `deposit_status`/`deposit_refunded`/`deposit_retained` beside the itemization model | decide in the phase-1 migration |
| Unused shadcn primitives | 25 of 46 in `components/ui/` | leave (vendored) |
| Stale local artifact | `.wrangler/` (Cloudflare preset, gitignored) | delete locally |
| Template leftover | `package.json` `"name": "tanstack_start_ts"` | rename to `rentio` |
| Superseded planning docs | `../PRD.md` (Mexico), `../LOVABLE_PROMPTS.md`, `../PROMPT V2.md`, `../SOLUTION.md`, `../LANDING.md` (outside the repo) | keep as history; `docs/PRD.md` outranks them |

**Doc drift** (not fixed in this pass, since it is outside the docs it created)

| Doc says | Code says |
|---|---|
| `SETUP.md` "51 tests" | 52 |
| `SETUP.md` "39/39 RLS assertions" | 54 `check()` calls, about 40 effective (two are always true: `rls_test.sql:157,249`) |
| `SETUP.md` edge functions "all four deployed" | 8 functions, table lists 8 |
| `SETUP.md` §2 publishes the demo password | S-003 |
| `SETUP.md` invoice email subject includes "Unidad 102" | the code path suggests the unit is blank (B-003, needs repro) |
| `supabase/functions/README.md` lists 4 functions, calls the tenant invite Spanish | 8 functions; invite is bilingual |
| `build-setup.py:26` and `seed-demo-logins.ts` say the seed "begins with TRUNCATE" | `seed.sql:13` uses `DELETE` |

**Verdict:** **fail for starting phase 1.** v1 is functionally complete and
all local gates are green. Phase 1 is blocked on:

1. S-001, S-002 and S-003 fixed
2. B-012 fixed
3. A working `DATABASE_URL` (pooler) so G5 can run
4. The owner's written approval of the spec
