-- Work orders point at a vendor from the directory (issue #11).
-- vendor_name / vendor_phone stay: the fallback when no vendor is linked, and
-- what older rows already hold.

alter table public.work_orders add column vendor_id uuid;

-- Composite key: the vendor must belong to the work order's own org. The
-- database refuses a cross-org pointer even through the service connection.
alter table public.work_orders
  add constraint work_orders_vendor_fkey
  foreign key (org_id, vendor_id) references public.vendors (org_id, id)
  on delete set null (vendor_id);

create index work_orders_vendor_id_idx on public.work_orders (vendor_id) where vendor_id is not null;

-- Backfill: one vendor per distinct free-text name per org (case and spaces
-- ignored), carrying a phone when any order had one, then link the orders.
insert into public.vendors (org_id, company_name, phone)
select org_id, min(trim(vendor_name)), max(nullif(trim(vendor_phone), ''))
from public.work_orders
where nullif(trim(vendor_name), '') is not null
group by org_id, lower(trim(vendor_name));

-- Only gaining a link: skip updated_at stamps and notification triggers.
alter table public.work_orders disable trigger user;
update public.work_orders w
set vendor_id = v.id
from public.vendors v
where v.org_id = w.org_id
  and lower(v.company_name) = lower(trim(w.vendor_name))
  and w.vendor_id is null;
alter table public.work_orders enable trigger user;
