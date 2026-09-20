-- Late fee audit — Texas Property Code §92.019.
--
--   psql "$DATABASE_URL" -f supabase/audits/late_fee_audit.sql
--
-- Read-only. Run it before the first real billing cycle, and again whenever
-- a lease's terms change, to find fees that were charged too early or above
-- the presumed-reasonable cap.
--
-- Two rules:
--   1. No fee unless the rent is still unpaid at the END of the second full
--      day after it was due, so the earliest chargeable date is
--      due_date + max(grace_days, 2) + 1.
--   2. Presumed reasonable up to 12% of one month's rent in a structure of
--      4 or fewer units, 10% above that. A presumption, not a ceiling — an
--      over-cap fee is a flag to review, not proof of a violation.
--
-- `charged_on` is when the fee line was written, which is the best available
-- proxy for when it was charged.

\echo ''
\echo '=== Late fees charged, checked against Texas Property Code 92.019 ==='
\echo ''

with structure as (
  select
    p.id as property_id,
    coalesce(p.units_in_structure, count(u.id)) as units_in_structure
  from public.properties p
  left join public.units u on u.property_id = p.id
  group by p.id, p.units_in_structure
),
fees as (
  select
    il.id                       as line_id,
    il.created_at::date         as charged_on,
    il.amount * il.quantity     as fee_amount,
    i.invoice_number,
    i.due_date,
    l.id                        as lease_id,
    l.rent_amount,
    greatest(l.grace_days, 2)   as effective_grace,
    l.late_fee_over_cap_ack,
    u.unit_number,
    pr.name                     as property_name,
    case when s.units_in_structure <= 4 then 12 else 10 end as cap_percent,
    t.full_name                 as tenant_name
  from public.invoice_lines il
  join public.invoices i   on i.id = il.invoice_id
  join public.leases l     on l.id = i.lease_id
  join public.units u      on u.id = l.unit_id
  join public.properties pr on pr.id = u.property_id
  join structure s         on s.property_id = pr.id
  left join lateral (
    select tn.full_name
    from public.lease_tenants lt
    join public.tenants tn on tn.id = lt.tenant_id
    where lt.lease_id = l.id and lt.role = 'primary'
    limit 1
  ) t on true
  where il.category = 'recargo'
),
judged as (
  select
    fees.*,
    due_date + effective_grace + 1 as earliest_lawful_date,
    round(case when rent_amount > 0 then fee_amount / rent_amount * 100 else 0 end, 2)
      as percent_of_rent
  from fees
)
select
  invoice_number,
  tenant_name,
  property_name || ' ' || unit_number as unit,
  to_char(due_date, 'MM/DD/YYYY')             as rent_due,
  to_char(earliest_lawful_date, 'MM/DD/YYYY') as chargeable_from,
  to_char(charged_on, 'MM/DD/YYYY')           as charged_on,
  to_char(fee_amount, 'FM999G999D00')         as fee,
  percent_of_rent || '%'                      as pct_of_rent,
  cap_percent || '%'                          as cap,
  case
    when charged_on < earliest_lawful_date and percent_of_rent > cap_percent
      then 'CHARGED TOO EARLY *and* OVER CAP'
    when charged_on < earliest_lawful_date
      then 'CHARGED TOO EARLY'
    when percent_of_rent > cap_percent and not late_fee_over_cap_ack
      then 'OVER CAP (not acknowledged)'
    when percent_of_rent > cap_percent
      then 'over cap (acknowledged)'
    else 'ok'
  end as verdict
from judged
order by
  (charged_on < earliest_lawful_date) desc,
  (percent_of_rent > cap_percent) desc,
  charged_on desc;

\echo ''
\echo '=== Summary ==='
\echo ''

with structure as (
  select p.id as property_id,
         coalesce(p.units_in_structure, count(u.id)) as units_in_structure
  from public.properties p
  left join public.units u on u.property_id = p.id
  group by p.id, p.units_in_structure
),
judged as (
  select
    il.created_at::date < (i.due_date + greatest(l.grace_days, 2) + 1) as too_early,
    case when l.rent_amount > 0
         then (il.amount * il.quantity) / l.rent_amount * 100 else 0 end
      > (case when s.units_in_structure <= 4 then 12 else 10 end) as over_cap,
    il.amount * il.quantity as fee_amount
  from public.invoice_lines il
  join public.invoices i    on i.id = il.invoice_id
  join public.leases l      on l.id = i.lease_id
  join public.units u       on u.id = l.unit_id
  join structure s          on s.property_id = u.property_id
  where il.category = 'recargo'
)
select
  count(*)                                       as late_fees_charged,
  coalesce(sum(fee_amount), 0)                   as total_charged,
  count(*) filter (where too_early)              as charged_too_early,
  coalesce(sum(fee_amount) filter (where too_early), 0) as refund_exposure_too_early,
  count(*) filter (where over_cap)               as over_cap,
  coalesce(sum(fee_amount) filter (where over_cap), 0)  as amount_over_cap
from judged;

\echo ''
\echo 'An empty table above means no late fee has been charged at all.'
\echo 'Anything flagged CHARGED TOO EARLY is a refund the client likely owes.'
\echo 'This is a compliance check, not legal advice.'
\echo ''
