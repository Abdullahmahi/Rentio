# Working in this repo

- `bun run dev` to run it, `bun test` for the suite, `bunx tsc --noEmit` and
  `bunx eslint .` before committing.
- Migrations live in `supabase/migrations/` and are applied in filename order.
  After adding one, run `bun run db:types` to regenerate `src/lib/database.types.ts`
  and `bun run db:setup` to rebuild `supabase/setup.sql`, which is generated.
- Demo logins come from `bun run db:demo-logins`, which prints the current set.
  Reseeding changes the tenant accounts, so trust that output over any doc.
- Coolify deploys `main` to production on push (see `SETUP.md` §5). Check the build before pushing.
- Server-only code lives in `src/lib/server/`; never import it from a component.

## Project docs (read before you change anything)

| File | Read it when |
| --- | --- |
| `docs/PRD.md` | Always. What the product is and isn't. Outranks any older planning doc. |
| `docs/TRD.md` | Before touching code. §Invariants are rules, not suggestions. |
| `docs/task_today.md` | Start of every session. Work only on what it names. |
| `docs/bugs.md` | A bug is reported. Hypothesis before code. |
| `docs/testing.md` | Before saying a feature is done. Run the gates and the cases it touches. |
| `docs/audit.md` | After every phase. Compare the code to the plan, flag gaps and orphans. |
| `docs/reports.md` | End of every session. Append what changed and what the checks said. |

Session loop: read `task_today.md` → build → `testing.md` → append to
`reports.md` → reset `task_today.md` (`git checkout docs/task_today.md`).
At the end of a phase, run `audit.md` too.
