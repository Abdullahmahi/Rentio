-- Autopay (issue #10): a tenant opts in to have rent charged to a saved
-- Stripe payment method on the due date. One enrollment per LEASE: two
-- co-tenants enrolled would both be charged for the same invoice.
--
-- The server writes the row after a SetupIntent succeeded on the company's
-- connected account (the saved method lives in Stripe, we keep its id and a
-- label). The tenant may only switch `enabled` on their own row; staff read
-- their company's enrollments.

create table public.autopay_enrollments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade
                      default public.current_org_id(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  lease_id            uuid not null unique references public.leases (id) on delete cascade,
  stripe_customer_id  text not null,
  payment_method_id   text not null,
  method_type         text not null check (method_type in ('card', 'ach')),
  -- "Visa •••• 4242" / "Chase •••• 6789": shown to the tenant and to staff.
  method_label        text,
  enabled             boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create trigger org_from_parent before insert or update on public.autopay_enrollments
  for each row execute function public.org_from_parent('leases', 'lease_id');
create trigger autopay_enrollments_set_updated_at
  before update on public.autopay_enrollments
  for each row execute function public.set_updated_at();

alter table public.autopay_enrollments enable row level security;
revoke all on public.autopay_enrollments from anon, authenticated;
grant select on public.autopay_enrollments to authenticated;
grant update (enabled) on public.autopay_enrollments to authenticated;

create policy autopay_enrollments_select on public.autopay_enrollments
  for select to authenticated
  using (public.is_staff() or tenant_id = public.my_tenant_id());
create policy autopay_enrollments_tenant_toggle on public.autopay_enrollments
  for update to authenticated
  using (tenant_id = public.my_tenant_id())
  with check (tenant_id = public.my_tenant_id());
create policy org_isolation on public.autopay_enrollments as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));
