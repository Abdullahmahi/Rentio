-- Stripe Connect OAuth state is single-use and bound to the admin who
-- started it (security review on PR #70). The signed state carries a nonce;
-- the nonce lives here until the callback consumes it (delete ... returning),
-- so a state cannot be replayed or finished by another user of the company.
-- Server routes only (service connection): no grant to anon/authenticated.

create table public.stripe_oauth_states (
  nonce       text primary key,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.stripe_oauth_states enable row level security;
revoke all on public.stripe_oauth_states from anon, authenticated;
