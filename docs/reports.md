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
