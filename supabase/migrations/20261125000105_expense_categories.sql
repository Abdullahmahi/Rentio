-- Expense categories, and an expense created from a work order (issue #12).
--
-- plan.md D6: a work order's cost never becomes an expense by itself. Staff
-- click "Create expense"; the link below only records which order it came
-- from, and the unique key stops the same order being expensed twice.

create type public.expense_category as enum (
  'repairs_maintenance', 'utilities', 'insurance', 'taxes', 'management',
  'supplies', 'cleaning', 'landscaping', 'legal_professional',
  'capital_improvement', 'other'
);

-- Existing rows take the default.
alter table public.expenses
  add column category public.expense_category not null default 'other',
  add column vendor_id uuid,
  add column work_order_id uuid;

-- Both pointers must stay inside the expense's own org (composite keys, like
-- work_orders.vendor_id).
alter table public.work_orders add constraint work_orders_org_id_id_key unique (org_id, id);

alter table public.expenses
  add constraint expenses_vendor_fkey
    foreign key (org_id, vendor_id) references public.vendors (org_id, id)
    on delete set null (vendor_id),
  add constraint expenses_work_order_fkey
    foreign key (org_id, work_order_id) references public.work_orders (org_id, id)
    on delete set null (work_order_id),
  add constraint expenses_work_order_id_key unique (work_order_id);

create index expenses_vendor_id_idx on public.expenses (vendor_id) where vendor_id is not null;
