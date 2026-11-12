-- nightly() ran every company in one transaction: one bad lease in org A
-- aborted invoicing for org B (audit-product-2026-10-28.md §4.3). Each
-- company now runs in its own sub-transaction; a failure is logged as a
-- warning, counted in the summary, and the loop moves on. Late-fee warnings
-- (one statement, all orgs) are unchanged.

create or replace function public.nightly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today   date := public.today_el_paso();
  period  date := date_trunc('month', public.today_el_paso())::date;
  org     record;
  made    int := 0;
  skipped int := 0;
  failed  uuid[] := '{}';
  r       record;
  queued  int;
begin
  for org in select id from public.organizations where status = 'active' loop
    begin
      if extract(day from today) = 1
         or not exists (select 1 from public.invoices where org_id = org.id and period_month = period) then
        select * into r from public.generate_invoices_for_org(period, org.id);
        made := made + r.created;
        skipped := skipped + r.skipped;
      end if;
    exception when others then
      raise warning 'nightly: invoicing failed for org %: %', org.id, sqlerrm;
      failed := failed || org.id;
    end;
  end loop;

  queued := public.queue_late_fee_warnings();

  return jsonb_build_object(
    'today', today,
    'period', period,
    'invoices_created', made,
    'invoices_skipped', skipped,
    'orgs_failed', to_jsonb(failed),
    'warnings_queued', queued
  );
end;
$$;

revoke all on function public.nightly() from public, anon, authenticated;
grant execute on function public.nightly() to service_role;
