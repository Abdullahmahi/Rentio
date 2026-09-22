-- A tenant with no invite needs somewhere to go.
--
-- The old "Set up portal access" screen asked for the email address the
-- office had on file, which a tenant usually does not know, and when there
-- was no match it said nothing and did nothing. This is the queue that turns
-- that dead end into a request a human can act on.

create type access_request_status as enum ('pending', 'approved', 'declined');

create table public.access_requests (
  id                uuid primary key default gen_random_uuid(),
  full_name         text not null,
  email             text not null,
  phone             text,
  -- What the person typed, not a foreign key: they are describing where they
  -- live in their own words, which is the whole point of the form.
  property_hint     text,
  unit_hint         text,
  status            access_request_status not null default 'pending',
  -- Best-effort match found at submission time, for staff to confirm or
  -- override. Never shown to the requester.
  matched_tenant_id uuid references public.tenants (id) on delete set null,
  note              text,
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

comment on table public.access_requests is
  'Portal access requests from people with no invite. Written only by the '
  'submit-access-request edge function under the service role; the table '
  'itself is staff-only.';

create index on public.access_requests (status, created_at desc);

create trigger access_requests_set_updated_at
  before update on public.access_requests
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- RLS
--
-- Staff-only, exactly like lease_notices. The public form does NOT insert
-- here directly: there is not one `to anon` policy anywhere in this schema,
-- and the only other anonymous endpoint (tenant-self-enroll) goes through an
-- edge function with the service role for the same reason. An anon-writable
-- table is an unauthenticated write sink with no place to validate or rate
-- limit.

alter table public.access_requests enable row level security;

create policy access_requests_staff_select on public.access_requests
  for select to authenticated using (public.is_staff());
create policy access_requests_staff_insert on public.access_requests
  for insert to authenticated with check (public.is_staff());
create policy access_requests_staff_update on public.access_requests
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy access_requests_admin_delete on public.access_requests
  for delete to authenticated using (public.is_admin());
