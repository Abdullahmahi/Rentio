-- A lease was five browser writes (lease, lease_tenants, turnover checklist,
-- unit status, activity) with no transaction: a failed link insert left an
-- orphan active lease on an occupied unit. One function, one transaction,
-- like record_payment. The contract PDF upload stays in the browser; a lease
-- without its file is still a lease.
--
-- p_terms carries the lease columns the wizard sets (start_date, end_date,
-- rent_amount, rent_due_day, grace_days, late_fee_type, late_fee_percent,
-- late_fee_amount, late_fee_over_cap_ack, deposit_amount). p_checklist is
-- turnoverRowsFor() from src/lib/texas.ts: [{item, item_key, position}].
-- The late-fee trigger and unique (lease_id, tenant_id) still apply inside.

create or replace function public.create_lease(
  p_unit       uuid,
  p_terms      jsonb,
  p_primary    uuid,
  p_co_tenants uuid[] default '{}',
  p_guarantors uuid[] default '{}',
  p_checklist  jsonb  default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_lease uuid;
  people    uuid[] := array[p_primary] || coalesce(p_co_tenants, '{}') || coalesce(p_guarantors, '{}');
begin
  if not public.is_staff() or public.current_org_id() is null then
    raise exception 'Only staff can create leases.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.units where id = p_unit and org_id = public.current_org_id()
  ) then
    raise exception 'That unit is not in your company.' using errcode = 'P0001';
  end if;
  if p_primary is null or array_position(people, null) is not null then
    raise exception 'Every party on the lease must be a saved tenant.' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(people) x) <> cardinality(people) then
    raise exception 'A person can hold only one role on a lease.' using errcode = 'P0001';
  end if;

  insert into public.leases (
    unit_id, start_date, end_date, rent_amount, rent_due_day, grace_days,
    late_fee_type, late_fee_percent, late_fee_amount, late_fee_over_cap_ack,
    deposit_amount, status
  ) values (
    p_unit,
    (p_terms->>'start_date')::date,
    (p_terms->>'end_date')::date,
    coalesce((p_terms->>'rent_amount')::numeric, 0),
    coalesce((p_terms->>'rent_due_day')::int, 1),
    coalesce((p_terms->>'grace_days')::int, 0),
    coalesce((p_terms->>'late_fee_type')::public.late_fee_type, 'percent'),
    coalesce((p_terms->>'late_fee_percent')::numeric, 0),
    coalesce((p_terms->>'late_fee_amount')::numeric, 0),
    coalesce((p_terms->>'late_fee_over_cap_ack')::boolean, false),
    coalesce((p_terms->>'deposit_amount')::numeric, 0),
    'activo'
  )
  returning id into new_lease;

  insert into public.lease_tenants (lease_id, tenant_id, role)
  select new_lease, p_primary, 'primary'::public.lease_tenant_role
  union all select new_lease, t, 'co_tenant'::public.lease_tenant_role
    from unnest(coalesce(p_co_tenants, '{}')) t
  union all select new_lease, t, 'guarantor'::public.lease_tenant_role
    from unnest(coalesce(p_guarantors, '{}')) t;

  -- §92.156: the 7-day rekey clock starts at possession, so the checklist
  -- exists from the lease's first second.
  insert into public.unit_turnover_checklist (unit_id, lease_id, item, item_key, position)
  select p_unit, new_lease, c->>'item', c->>'item_key', coalesce((c->>'position')::int, 0)
  from jsonb_array_elements(coalesce(p_checklist, '[]')) c;

  update public.units set status = 'ocupada' where id = p_unit;

  return new_lease;
end;
$$;

revoke all on function public.create_lease(uuid, jsonb, uuid, uuid[], uuid[], jsonb) from public, anon;
grant execute on function public.create_lease(uuid, jsonb, uuid, uuid[], uuid[], jsonb) to authenticated, service_role;
