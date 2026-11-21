-- E-sign follow-up (design review #34, #36).
--
--   * A signer may decline, with an optional reason. The whole request
--     becomes 'declined' (staff see who and why; nothing can be completed).
--   * Signers are required by default. The finaliser waits for every
--     required signer only; an optional one may still be unsigned.

alter table public.signature_signers
  add column required       boolean not null default true,
  add column declined_at    timestamptz,
  add column decline_reason text check (length(decline_reason) <= 500),
  add constraint signature_signers_sign_or_decline check (signed_at is null or declined_at is null);

grant select (required, declined_at, decline_reason) on public.signature_signers to authenticated;

alter table public.signature_requests drop constraint signature_requests_status_check;
alter table public.signature_requests
  add constraint signature_requests_status_check
  check (status in ('sent', 'completed', 'voided', 'declined'));

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
        select 1 from public.signature_signers s
        where s.request_id = r.id and s.required and s.signed_at is null
      )
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.complete_signature_request(
  p_request      uuid,
  p_signed_path  text,
  p_signed_sha   text,
  p_name         text,
  p_tenant_paths jsonb
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
    select 1 from public.signature_signers
    where request_id = r.id and required and signed_at is null
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
  where s.request_id = r.id and s.tenant_id is not null and s.signed_at is not null
    and p_tenant_paths ? s.tenant_id::text;

  if (select status from public.leases where id = r.lease_id) = 'borrador' then
    perform public.activate_lease(r.lease_id);
  end if;
end;
$$;

-- The signer said no. Atomic: the signer row and the request change
-- together, and only while both are still open. Returns false otherwise.
create or replace function public.decline_signature(p_signer uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.signature_signers%rowtype;
begin
  select * into s from public.signature_signers where id = p_signer;
  if s.id is null then
    return false;
  end if;
  -- Same lock order as the finaliser: the request first.
  perform 1 from public.signature_requests where id = s.request_id and status = 'sent' for update;
  if not found then
    return false;
  end if;
  update public.signature_signers
  set declined_at = now(), decline_reason = nullif(left(btrim(p_reason), 500), '')
  where id = p_signer and signed_at is null and declined_at is null;
  if not found then
    return false;
  end if;
  update public.signature_requests set status = 'declined' where id = s.request_id;
  return true;
end;
$$;

revoke all on function public.claim_signature_finalisation(uuid) from public, anon, authenticated;
revoke all on function public.complete_signature_request(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.decline_signature(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_signature_finalisation(uuid) to service_role;
grant execute on function public.complete_signature_request(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.decline_signature(uuid, text) to service_role;
