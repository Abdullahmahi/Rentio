-- E-sign security review (#73).
--
--   * Staff no longer write signature_requests / signature_signers at all.
--     Every change is a SECURITY DEFINER function with one explicit
--     transition: send, resend, cancel (status 'voided'). Signing, consent
--     and decline are service-only (the public /sign link).
--   * completed, declined and voided are terminal: a guard trigger freezes
--     the row, and freezes a signer's evidence (signed_at, signature, IP,
--     user agent, consent) once they signed or declined. Cancelling burns
--     every link's token hash.
--   * The original is filed by the server at <lease>/esign-<request>-original.pdf,
--     a path staff uploads refuse; the server re-hashes it against
--     original_sha256 before showing or stamping it.
--   * Consent is recorded on its own, when the box is ticked: the time, the
--     language and the SHA-256 of the exact disclosure text shown.
--   * Nobody signed in reads IP, user agent, signature image or consent
--     details: they live on the signed PDF's record page.

alter table public.signature_signers
  add column consent_locale      text check (consent_locale in ('en', 'es-MX')),
  add column consent_text_sha256 text check (consent_text_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint signature_signers_signed_with_consent check (
    signed_at is null or (consent_locale is not null and consent_text_sha256 is not null
                          and consent_at <= signed_at)
  );

-- ------------------------------------------------------------ privileges
revoke insert, update, delete on public.signature_requests, public.signature_signers
  from authenticated;
drop policy signature_requests_staff_insert on public.signature_requests;
drop policy signature_requests_staff_update on public.signature_requests;
drop policy signature_signers_staff_insert on public.signature_signers;
drop policy signature_signers_staff_update on public.signature_signers;
-- Tenants could read a co-signer's IP, device and signature image.
revoke select (ip, user_agent, signature_data, consent_at, consent_version)
  on public.signature_signers from authenticated;

-- ------------------------------------------------------------ guard
create or replace function public.signature_requests_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.lease_id, new.original_path, new.original_sha256, new.page_count, new.created_by, new.created_at)
     is distinct from
     (old.lease_id, old.original_path, old.original_sha256, old.page_count, old.created_by, old.created_at) then
    raise exception 'What was sent cannot change.' using errcode = '42501';
  end if;
  if old.status <> 'sent' and row(new.*) is distinct from row(old.*) then
    raise exception 'This agreement is closed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger zz_guard before update on public.signature_requests
  for each row execute function public.signature_requests_guard();

create or replace function public.signature_signers_guard()
returns trigger
language plpgsql
as $$
begin
  if (old.signed_at is not null or old.declined_at is not null)
     and (new.signed_at, new.signature_kind, new.signature_data, new.ip, new.user_agent,
          new.consent_at, new.consent_version, new.consent_locale, new.consent_text_sha256,
          new.declined_at, new.decline_reason)
     is distinct from
         (old.signed_at, old.signature_kind, old.signature_data, old.ip, old.user_agent,
          old.consent_at, old.consent_version, old.consent_locale, old.consent_text_sha256,
          old.declined_at, old.decline_reason) then
    raise exception 'A signature, once given or declined, is final.' using errcode = '42501';
  end if;
  if (new.request_id, new.name, new.email, new.tenant_id, new.page, new.x, new.y, new.w, new.h)
     is distinct from (old.request_id, old.name, old.email, old.tenant_id, old.page, old.x, old.y, old.w, old.h) then
    raise exception 'Who signs and where cannot change.' using errcode = '42501';
  end if;
  if new.signed_at is not null and old.signed_at is null
     and (select status from public.signature_requests where id = new.request_id) <> 'sent' then
    raise exception 'This agreement is closed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger zz_guard before update on public.signature_signers
  for each row execute function public.signature_signers_guard();

-- ------------------------------------------------------------ staff
-- Send: the request and its signers in one go. The id is minted by the
-- server, which has already copied the PDF to the request's own path.
create or replace function public.send_signature_request(
  p_id         uuid,
  p_lease      uuid,
  p_title      text,
  p_message    text,
  p_sha        text,
  p_page_count int,
  p_expires_at timestamptz,
  p_signers    jsonb   -- [{id,name,email,tenant_id,locale,position,required,page,x,y,w,h,token_hash}]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lease_org uuid := (select org_id from public.leases where id = p_lease);
begin
  if not public.is_staff() or lease_org is null or lease_org is distinct from public.current_org_id() then
    raise exception 'Only staff can send agreements on their own leases.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_signers) <> 'array' or jsonb_array_length(p_signers) = 0 then
    raise exception 'At least one signer is required.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_signers) s
    where nullif(s ->> 'tenant_id', '') is not null
      and not exists (select 1 from public.lease_tenants lt
                      where lt.lease_id = p_lease and lt.tenant_id = (s ->> 'tenant_id')::uuid)
  ) then
    raise exception 'A tenant signer must be on this lease.' using errcode = '22023';
  end if;

  insert into public.signature_requests
    (id, org_id, lease_id, title, message, original_path, original_sha256, page_count, created_by, expires_at)
  values
    (p_id, lease_org, p_lease, p_title, p_message, format('%s/esign-%s-original.pdf', p_lease, p_id),
     p_sha, p_page_count, public.current_user_id(), p_expires_at);

  insert into public.signature_signers
    (id, org_id, request_id, name, email, tenant_id, locale, position, required,
     page, x, y, w, h, token_hash, token_expires_at)
  select (s ->> 'id')::uuid, lease_org, p_id, s ->> 'name', s ->> 'email',
         nullif(s ->> 'tenant_id', '')::uuid, coalesce(s ->> 'locale', 'es-MX'),
         coalesce((s ->> 'position')::int, 0), coalesce((s ->> 'required')::boolean, true),
         (s ->> 'page')::int, (s ->> 'x')::numeric, (s ->> 'y')::numeric,
         (s ->> 'w')::numeric, (s ->> 'h')::numeric, s ->> 'token_hash', p_expires_at
  from jsonb_array_elements(p_signers) s;
  return p_id;
end;
$$;

-- Resend: a new link (the old one stops working) and more time.
create or replace function public.resend_signature_link(
  p_signer uuid, p_token_hash text, p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.signature_signers%rowtype;
begin
  select * into s from public.signature_signers where id = p_signer;
  if not public.is_staff() or s.id is null or s.org_id is distinct from public.current_org_id() then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  perform 1 from public.signature_requests where id = s.request_id and status = 'sent' for update;
  if not found or s.signed_at is not null or s.declined_at is not null then
    return false;
  end if;
  update public.signature_signers
  set token_hash = p_token_hash, token_expires_at = p_expires_at, emailed_at = null
  where id = p_signer;
  update public.signature_requests set expires_at = p_expires_at
  where id = s.request_id and expires_at < p_expires_at;
  return true;
end;
$$;

create or replace function public.mark_signature_emailed(p_signer uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.signature_signers set emailed_at = now()
  where id = p_signer and public.is_staff() and org_id = public.current_org_id();
$$;

-- Cancel (status 'voided'): only while it is still out for signature.
-- Every link's hash is replaced by the hash of a random value nobody holds.
-- Returns the lease, or null when there was nothing to cancel.
create or replace function public.cancel_signature_request(p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.signature_requests%rowtype;
begin
  select * into r from public.signature_requests where id = p_request for update;
  if not public.is_staff() or r.id is null or r.org_id is distinct from public.current_org_id() then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  if r.status <> 'sent' then
    return null;
  end if;
  update public.signature_requests set status = 'voided', voided_at = now(), finalizing_at = null
  where id = r.id;
  update public.signature_signers
  set token_hash = encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
      token_expires_at = now()
  where request_id = r.id;
  return r.lease_id;
end;
$$;

-- ------------------------------------------------------------ service (/sign)
-- Consent, ticked before signing: its own time, language and text hash.
create or replace function public.record_signature_consent(
  p_signer uuid, p_version text, p_locale text, p_text_sha text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.signature_signers s
  set consent_at = now(), consent_version = p_version, consent_locale = p_locale,
      consent_text_sha256 = p_text_sha
  from public.signature_requests r
  where s.id = p_signer and r.id = s.request_id and r.status = 'sent'
    and s.signed_at is null and s.declined_at is null
    and s.token_expires_at > now() and r.expires_at > now();
  return found;
end;
$$;

-- Sign. The request row is locked first (same order as decline and the
-- finaliser), so a cancel or decline cannot land in between.
create or replace function public.sign_signature(
  p_signer uuid, p_kind text, p_data text, p_ip text, p_user_agent text
)
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
  perform 1 from public.signature_requests
  where id = s.request_id and status = 'sent' and expires_at > now()
  for update;
  if not found then
    return false;
  end if;
  update public.signature_signers
  set signed_at = now(), viewed_at = coalesce(viewed_at, now()), signature_kind = p_kind,
      signature_data = p_data, ip = p_ip, user_agent = left(p_user_agent, 500)
  where id = p_signer and signed_at is null and declined_at is null
    and consent_at is not null and token_expires_at > now();
  return found;
end;
$$;

revoke all on function public.send_signature_request(uuid, uuid, text, text, text, int, timestamptz, jsonb),
  public.resend_signature_link(uuid, text, timestamptz),
  public.mark_signature_emailed(uuid),
  public.cancel_signature_request(uuid),
  public.record_signature_consent(uuid, text, text, text),
  public.sign_signature(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.send_signature_request(uuid, uuid, text, text, text, int, timestamptz, jsonb),
  public.resend_signature_link(uuid, text, timestamptz),
  public.mark_signature_emailed(uuid),
  public.cancel_signature_request(uuid)
  to authenticated, service_role;
grant execute on function public.record_signature_consent(uuid, text, text, text),
  public.sign_signature(uuid, text, text, text, text)
  to service_role;
