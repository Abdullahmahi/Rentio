-- Stripe Connect (issue #8): each company connects its OWN Stripe account
-- (Standard account, direct charges). Rent goes straight to the company's
-- Stripe balance; Rentio never holds it. One row per organization.
--
-- Who writes what:
--   stripe_account_id, charges_enabled, payouts_enabled, details_submitted,
--   status          server routes only (service connection), from Stripe.
--   card_fee_enabled, card_fee_percent   any staff of the company, from Settings.
-- Staff read their company's row; tenants never read it (the portal gets
-- what it needs through a server route).

create table public.stripe_accounts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null unique references public.organizations (id) on delete cascade
                     default public.current_org_id(),
  stripe_account_id  text unique,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  -- not_connected: no account yet or disconnected; pending: connected but
  -- Stripe has not enabled charges; ready: can take rent.
  status             text not null default 'not_connected'
                     check (status in ('not_connected', 'pending', 'ready')),
  -- Passing the card processing cost on to the tenant is the owner's legal
  -- call (card-network rules and state law). Off until staff turn it on.
  -- ponytail: 4% cap = the card networks' surcharge ceiling; ACH never carries a fee.
  card_fee_enabled   boolean not null default false,
  card_fee_percent   numeric(5,2) not null default 0
                     check (card_fee_percent >= 0 and card_fee_percent <= 4),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

create trigger stripe_accounts_set_updated_at
  before update on public.stripe_accounts
  for each row execute function public.set_updated_at();

alter table public.stripe_accounts enable row level security;
revoke all on public.stripe_accounts from anon, authenticated;
grant select on public.stripe_accounts to authenticated;
-- Column grant: staff can flip the fee, nobody but the server can touch
-- the account id or its Stripe status.
grant update (card_fee_enabled, card_fee_percent) on public.stripe_accounts to authenticated;

create policy stripe_accounts_staff_select on public.stripe_accounts
  for select to authenticated using (public.is_staff());
create policy stripe_accounts_staff_update on public.stripe_accounts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy org_isolation on public.stripe_accounts as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));
