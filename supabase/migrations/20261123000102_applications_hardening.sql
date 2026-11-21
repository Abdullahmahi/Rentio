-- Applications security review (#75).
--
--   * Nobody but the service connection sets or changes an application's
--     login (profile_id), link or email; approve_application refuses a
--     login that is not an applicant of this company.
--   * application_files rows are written only by the app server, after it
--     checked the file's real type. path is <application_id>/<uuid>.<ext>
--     (a check constraint), and an application holds at most 10 files and
--     50 MB.
--   * A login opens at most 5 applications a day.
--   * An approved applicant (tenant_id set, role still 'applicant') does
--     not read tenant notifications.
--   * purge_closed_application_pii(days): ID scans and dates of birth of
--     denied or withdrawn applications go after 90 days. Exported for the
--     server (purgeClosedApplicationPii); not scheduled yet.

alter table public.applications drop constraint applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status in ('draft', 'submitted', 'under_review', 'approved', 'denied', 'lease_sent', 'withdrawn'));

-- ------------------------------------------------- who the application is
create or replace function public.applications_restrict_applicant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_id() is null then
    return new;  -- the app server's service connection
  end if;
  -- Who applied, through which link, with which verified email: fixed for
  -- staff too, so an application cannot be pointed at someone else's login.
  if new.org_id is distinct from old.org_id
     or new.profile_id is distinct from old.profile_id
     or new.link_id is distinct from old.link_id
     or new.email is distinct from old.email then
    raise exception 'Who applied cannot change.' using errcode = '42501';
  end if;
  if public.is_staff() then
    return new;
  end if;
  if new.unit_id is distinct from old.unit_id
     or new.tenant_id is distinct from old.tenant_id
     or new.lease_id is distinct from old.lease_id
     or not (new.status = old.status or (old.status = 'draft' and new.status = 'submitted')) then
    raise exception 'Only the office can change that on an application.' using errcode = '42501';
  end if;
  if new.status = 'submitted' and old.status = 'draft' then
    new.submitted_at := now();
  else
    new.submitted_at := old.submitted_at;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------- rate limit
create or replace function public.applications_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.applications
      where profile_id = new.profile_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many applications today. Try again tomorrow.' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger applications_rate_limit before insert on public.applications
  for each row execute function public.applications_rate_limit();

-- ------------------------------------------------- files
alter table public.application_files
  add column size_bytes   bigint not null default 0 check (size_bytes >= 0),
  add column content_type text check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  add constraint application_files_path_check
    check (path ~ ('^' || application_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|heic)$'));

-- The server inserts after sniffing the bytes; applicants and staff may
-- still remove a row (draft only, for the applicant).
revoke insert, update on public.application_files from authenticated;

create or replace function public.application_files_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int; total bigint;
begin
  -- Serialise uploads to one application, so two at once cannot both fit.
  perform 1 from public.applications where id = new.application_id for update;
  select count(*), coalesce(sum(size_bytes), 0) into n, total
  from public.application_files where application_id = new.application_id;
  if n >= 10 or total + new.size_bytes > 50 * 1024 * 1024 then
    raise exception 'An application holds at most 10 files and 50 MB.' using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger application_files_limit before insert on public.application_files
  for each row execute function public.application_files_limit();

-- ------------------------------------------------- approve
create or replace function public.approve_application(
  p_application uuid,
  p_terms       jsonb,
  p_unit        uuid  default null,
  p_note        text  default null,
  p_checklist   jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a          public.applications%rowtype;
  login      public.profiles%rowtype;
  unit       uuid;
  new_tenant uuid;
  co         uuid[];
  new_lease  uuid;
begin
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can approve applications.' using errcode = '42501';
  end if;
  select * into a from public.applications
  where id = p_application and org_id = public.current_org_id()
  for update;
  if a.id is null then
    raise exception 'Application not found.' using errcode = 'P0002';
  end if;
  if a.lease_id is not null and a.status in ('approved', 'lease_sent') then
    return jsonb_build_object('tenant_id', a.tenant_id, 'lease_id', a.lease_id);  -- idempotent
  end if;
  if a.status not in ('submitted', 'under_review') then
    raise exception 'Only a submitted application can be approved.' using errcode = 'P0001';
  end if;
  unit := coalesce(p_unit, a.unit_id);
  if unit is null then
    raise exception 'Pick a unit for this lease.' using errcode = '22023';
  end if;
  -- The login that applied (profile_id cannot change after insert), and
  -- only while it is an applicant of this same company.
  select * into login from public.profiles where id = a.profile_id;
  if login.id is null or login.org_id is distinct from a.org_id or login.role <> 'applicant' then
    raise exception 'This application''s login is not an applicant of this company.' using errcode = '42501';
  end if;

  insert into public.tenants (org_id, full_name, email, phone)
  values (a.org_id, coalesce(nullif(trim(a.full_name), ''), login.full_name, login.email),
          login.email, a.phone)
  returning id into new_tenant;

  -- Co-applicants sign as co-tenants.
  with made as (
    insert into public.tenants (org_id, full_name, email, phone)
    select a.org_id, c.full_name, c.email, c.phone
    from public.application_co_applicants c
    where c.application_id = a.id
    returning id
  )
  select coalesce(array_agg(id), '{}') into co from made;

  new_lease := public.create_lease(
    unit, coalesce(p_terms, '{}'::jsonb) || '{"status": "borrador"}'::jsonb,
    new_tenant, co, '{}', coalesce(p_checklist, '[]'::jsonb));

  perform set_config('rentio.applicant_step', 'on', true);
  update public.profiles set tenant_id = new_tenant
  where id = login.id and org_id = a.org_id and role = 'applicant' and tenant_id is null;
  perform set_config('rentio.applicant_step', 'off', true);

  update public.applications
  set status = 'approved', unit_id = unit, tenant_id = new_tenant, lease_id = new_lease
  where id = a.id;

  insert into public.application_reviews (org_id, application_id, decision_note, decided_by, decided_at)
  values (a.org_id, a.id, nullif(trim(p_note), ''), public.current_user_id(), now())
  on conflict (application_id) do update
    set decision_note = coalesce(excluded.decision_note, application_reviews.decision_note),
        decided_by = excluded.decided_by, decided_at = excluded.decided_at;

  insert into public.activity_log (actor_id, entity_type, entity_id, action, meta, org_id)
  values (public.current_user_id(), 'application', a.id, 'approve',
          jsonb_build_object('tenant_id', new_tenant, 'lease_id', new_lease, 'unit_id', unit),
          a.org_id);

  return jsonb_build_object('tenant_id', new_tenant, 'lease_id', new_lease);
end;
$$;

-- ------------------------------------------------- notifications
-- my_tenant_id() ignores an applicant's tenant_id until promotion.
drop policy notifications_select on public.notifications;
drop policy notifications_tenant_read on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (public.is_staff() or tenant_id = (select public.my_tenant_id()));
create policy notifications_tenant_read on public.notifications
  for update to authenticated
  using (tenant_id = (select public.my_tenant_id()))
  with check (tenant_id = (select public.my_tenant_id()));

-- ------------------------------------------------- retention
-- Service only. Deletes the ID-scan rows and clears date_of_birth on
-- applications denied or withdrawn more than p_days ago, and returns the
-- deleted files so the server removes them from disk.
create or replace function public.purge_closed_application_pii(p_days int default 90)
returns table (org_id uuid, path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with closed as (
    select a.id from public.applications a
    where a.status in ('denied', 'withdrawn')
      and coalesce(a.updated_at, a.created_at) < now() - make_interval(days => p_days)
  ), cleared as (
    update public.applications a set date_of_birth = null
    where a.id in (select id from closed) and a.date_of_birth is not null
  )
  delete from public.application_files f
  where f.application_id in (select id from closed) and f.kind = 'id'
  returning f.org_id, f.path;
end;
$$;

revoke all on function public.applications_rate_limit(), public.application_files_limit(),
  public.purge_closed_application_pii(int) from public, anon, authenticated;
grant execute on function public.purge_closed_application_pii(int) to service_role;
