# Rentio

Property and rental management for a portfolio in El Paso, Texas. Two portals:
an internal one for staff and a tenant-facing one, both bilingual
(English / Spanish).

Built with TanStack Start, React, TypeScript, Tailwind CSS and Supabase.

## Running it

```sh
bun install
bun run dev
```

Setting up the database, the environment variables and the demo logins is in
[SETUP.md](SETUP.md).

## Checks

```sh
bun test                 # unit tests
bunx tsc --noEmit        # types
bunx eslint .            # lint
bun run build            # production build
```

Texas Property Code compliance — late fees, security deposits, repair
notices — is summarised at the end of [SETUP.md](SETUP.md). It is a build
specification, not legal advice.
