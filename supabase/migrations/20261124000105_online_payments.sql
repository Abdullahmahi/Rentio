-- Pay now (issue #9): online rent through the company's own Stripe account.
--
--   payments.stripe_payment_intent_id   one payment per PaymentIntent (idempotency)
--   payments.stripe_charge_id           for the owner's Stripe dashboard
--   stripe_events                       every webhook event once, per company
--   stripe_customers                    the tenant's Customer on the company's account
--
-- Only the server writes any of this (webhook and portal routes, service
-- connection, always filtered by the org derived from the account or the
-- caller's session). Staff read their company's rows; a tenant reads their
-- own customer row and nothing else.

alter table public.payments
  add column if not exists stripe_payment_intent_id text unique,
  add column if not exists stripe_charge_id text;

-- ------------------------------------------------------------ stripe_events
create table public.stripe_events (
  event_id      text primary key,
  org_id        uuid not null references public.organizations (id) on delete cascade
                default public.current_org_id(),
  type          text not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);
create index stripe_events_org_idx on public.stripe_events (org_id, received_at desc);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
grant select on public.stripe_events to authenticated;

create policy stripe_events_staff_select on public.stripe_events
  for select to authenticated using (public.is_staff());
create policy org_isolation on public.stripe_events as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));

-- --------------------------------------------------------- stripe_customers
create table public.stripe_customers (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade
                      default public.current_org_id(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  stripe_customer_id  text not null,
  created_at          timestamptz not null default now(),
  unique (org_id, tenant_id),
  unique (org_id, stripe_customer_id)
);

create trigger org_from_parent before insert or update on public.stripe_customers
  for each row execute function public.org_from_parent('tenants', 'tenant_id');

alter table public.stripe_customers enable row level security;
revoke all on public.stripe_customers from anon, authenticated;
grant select on public.stripe_customers to authenticated;

create policy stripe_customers_select on public.stripe_customers
  for select to authenticated
  using (public.is_staff() or tenant_id = public.my_tenant_id());
create policy org_isolation on public.stripe_customers as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));
