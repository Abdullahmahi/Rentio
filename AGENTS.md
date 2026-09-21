# Working in this repo

- `bun run dev` to run it, `bun test` for the suite, `bunx tsc --noEmit` and
  `bunx eslint .` before committing.
- Migrations live in `supabase/migrations/` and are applied in filename order.
  After adding one, run `bun run db:types` to regenerate `src/lib/database.types.ts`
  and `bun run db:setup` to rebuild `supabase/setup.sql`, which is generated.
- Demo logins come from `bun run db:demo-logins`, which prints the current set.
  Reseeding changes the tenant accounts, so trust that output over any doc.
- `main` deploys to production on push. Check the build before pushing.
