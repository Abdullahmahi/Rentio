-- E-sign: a lease PDF sent to its tenants (or applicants) for signature.
--
--   signature_requests  one per document sent; the original and, once every
--                       signer is done, the signed PDF with its record page.
--   signature_signers   one per person, with their own link, their spot on
--                       the page and the evidence of their signature.
--
-- Staff manage both through RLS. A tenant may read requests on their own
-- leases. Anonymous signers never reach PostgREST: the app server resolves
-- their link by the SHA-256 of its token (the token itself is never stored)
-- and acts with the service connection, filtered by the request's org.
--
--   claim_signature_finalisation(request)   service: one finaliser at a time
--   complete_signature_request(request, ..)  service: atomic "it is signed"

create table public.signature_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade
                    default public.current_org_id(),
  lease_id        uuid not null references public.leases (id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  message         text check (length(message) <= 2000),
  -- contracts bucket, <lease_id>/<file>
  original_path   text not null,
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  page_count      int  not null check (page_count > 0),
  signed_path     text,
  signed_sha256   text check (signed_sha256 ~ '^[0-9a-f]{64}$'),
  status          text not null default 'sent' check (status in ('sent', 'completed', 'voided')),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  finalizing_at   timestamptz,
  completed_at    timestamptz,
  voided_at       timestamptz
);
create index signature_requests_lease_idx on public.signature_requests (lease_id, created_at desc);
create index signature_requests_org_idx on public.signature_requests (org_id);

create table public.signature_signers (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade
                     default public.current_org_id(),
  request_id       uuid not null references public.signature_requests (id) on delete cascade,
  name             text not null check (length(name) between 1 and 120),
  email            text not null check (length(email) between 3 and 160),
  tenant_id        uuid references public.tenants (id) on delete set null,
  locale           text not null default 'es-MX' check (locale in ('en', 'es-MX')),
  position         int  not null default 0,
  -- Where they sign: 1-based page, box in PDF points from the page's
  -- lower-left corner (pdf-lib's coordinate space).
  page             int     not null check (page > 0),
  x                numeric not null check (x >= 0),
  y                numeric not null check (y >= 0),
  w                numeric not null check (w > 0),
  h                numeric not null check (h > 0),
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz not null,
  emailed_at       timestamptz,
  viewed_at        timestamptz,
  signed_at        timestamptz,
  ip               text,
  user_agent       text,
  signature_kind   text check (signature_kind in ('drawn', 'typed')),
  -- drawn: a PNG data URL; typed: the text
  signature_data   text check (length(signature_data) <= 300000),
  consent_at       timestamptz,
  consent_version  text,
  created_at       timestamptz not null default now(),
  check (signed_at is null or (signature_kind is not null and signature_data is not null
                               and consent_at is not null and consent_version is not null))
);
create index signature_signers_request_idx on public.signature_signers (request_id, position);
create index signature_signers_org_idx on public.signature_signers (org_id);

-- Same parent-derived org as every other child table.
create trigger org_from_parent before insert or update on public.signature_requests
  for each row execute function public.org_from_parent('leases', 'lease_id');
create trigger org_from_parent before insert or update on public.signature_signers
  for each row execute function public.org_from_parent('signature_requests', 'request_id');

alter table public.signature_requests enable row level security;
alter table public.signature_signers  enable row level security;

-- Nothing for anon. Tenants and staff never see token_hash: it is left out
-- of the column grant, so `select token_hash` (or `*`) is refused outright.
revoke all on public.signature_requests, public.signature_signers from anon;
revoke select on public.signature_signers from authenticated;
grant select (id, org_id, request_id, name, email, tenant_id, locale, position, page, x, y, w, h,
              token_expires_at, emailed_at, viewed_at, signed_at, ip, user_agent,
              signature_kind, signature_data, consent_at, consent_version, created_at)
  on public.signature_signers to authenticated;

create policy org_isolation on public.signature_requests as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));
create policy org_isolation on public.signature_signers as restrictive for all to authenticated
  using (org_id = (select public.current_org_id()) or (select public.is_super_admin()))
  with check (org_id = (select public.current_org_id()) or (select public.is_super_admin()));

create policy signature_requests_select on public.signature_requests
  for select to authenticated
  using (public.is_staff() or lease_id in (select public.my_lease_ids()));
create policy signature_requests_staff_insert on public.signature_requests
  for insert to authenticated with check (public.is_staff());
create policy signature_requests_staff_update on public.signature_requests
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy signature_signers_select on public.signature_signers
  for select to authenticated
  using (
    public.is_staff()
    or request_id in (
      select r.id from public.signature_requests r
      where r.lease_id in (select public.my_lease_ids())
    )
  );
create policy signature_signers_staff_insert on public.signature_signers
  for insert to authenticated with check (public.is_staff());
create policy signature_signers_staff_update on public.signature_signers
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- No delete policies: a sent agreement is evidence. Staff void it instead.

-- ------------------------------------------------------------ finalisation
-- Two signers can finish within the same second. Only one may build the
-- signed PDF: the claim is a conditional update, so exactly one caller gets
-- true. A claim older than two minutes is a crashed finaliser and may be
-- retaken, which is why everything after it is idempotent.

create or replace function public.claim_signature_finalisation(p_request uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.signature_requests r
    set finalizing_at = now()
    where r.id = p_request
      and r.status = 'sent'
      and (r.finalizing_at is null or r.finalizing_at < now() - interval '2 minutes')
      and not exists (
        select 1 from public.signature_signers s where s.request_id = r.id and s.signed_at is null
      )
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- Marks the request signed, files the signed PDF on the lease and on each
-- signer's tenant record, and activates a draft lease. One transaction with
-- the request row locked, so a retry or a racing caller is a no-op.
create or replace function public.complete_signature_request(
  p_request      uuid,
  p_signed_path  text,
  p_signed_sha   text,
  p_name         text,
  p_tenant_paths jsonb   -- {"<tenant_id>": "<tenant-docs path>"}
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.signature_requests%rowtype;
begin
  select * into r from public.signature_requests where id = p_request for update;
  if r.id is null then
    raise exception 'Signature request not found.' using errcode = 'P0002';
  end if;
  if r.status = 'completed' then
    return;  -- idempotent
  end if;
  if r.status <> 'sent' or exists (
    select 1 from public.signature_signers where request_id = r.id and signed_at is null
  ) then
    raise exception 'This agreement is not ready to complete.' using errcode = 'P0001';
  end if;

  update public.signature_requests
  set status = 'completed', completed_at = now(), finalizing_at = null,
      signed_path = p_signed_path, signed_sha256 = p_signed_sha
  where id = r.id;

  insert into public.documents (org_id, owner_type, owner_id, name, url)
  values (r.org_id, 'lease', r.lease_id, p_name, p_signed_path);

  insert into public.documents (org_id, owner_type, owner_id, name, url)
  select distinct r.org_id, 'tenant', s.tenant_id, p_name, p_tenant_paths ->> s.tenant_id::text
  from public.signature_signers s
  where s.request_id = r.id and s.tenant_id is not null
    and p_tenant_paths ? s.tenant_id::text;

  if (select status from public.leases where id = r.lease_id) = 'borrador' then
    perform public.activate_lease(r.lease_id);
  end if;
end;
$$;

revoke all on function public.claim_signature_finalisation(uuid) from public, anon, authenticated;
revoke all on function public.complete_signature_request(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_signature_finalisation(uuid) to service_role;
grant execute on function public.complete_signature_request(uuid, text, text, text, jsonb) to service_role;
