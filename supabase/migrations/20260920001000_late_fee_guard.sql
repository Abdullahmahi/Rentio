-- Prompt 17 said "do not let a manager bypass the 2-day rule anywhere in the
-- UI". The gated "Apply late fee" button honoured it; "Add line" did not.
-- A manager could pick the "Late fee" category by hand and write a fee of any
-- size to an invoice due today. Verified against the live database before
-- this migration: a $999 late fee inserted with no check at all.
--
-- The button is not the guard. This is.

create or replace function public.enforce_late_fee_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv        record;
  grace      int;
  eligible   date;
  existing   int;
begin
  if new.category <> 'recargo' then
    return new;
  end if;

  select i.due_date, i.lease_id into inv
  from public.invoices i where i.id = new.invoice_id;

  if not found then
    return new;
  end if;

  select greatest(l.grace_days, 2) into grace
  from public.leases l where l.id = inv.lease_id;

  -- §92.019(a): the rent must still be unpaid at the END of the second full
  -- day after it was due, so the fee is chargeable from the day after that.
  -- A longer grace period in the lease wins.
  eligible := inv.due_date + coalesce(grace, 2) + 1;

  if current_date < eligible then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Texas Property Code 92.019: a late fee on this invoice cannot be charged before %s.',
        to_char(eligible, 'MM/DD/YYYY')
      );
  end if;

  -- One late fee per invoice, whichever path wrote it.
  select count(*) into existing
  from public.invoice_lines il
  where il.invoice_id = new.invoice_id
    and il.category = 'recargo'
    and il.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if existing > 0 then
    raise exception using
      errcode = 'check_violation',
      message = 'This invoice already has a late fee.';
  end if;

  return new;
end;
$$;

create trigger invoice_lines_enforce_late_fee_rules
  before insert or update on public.invoice_lines
  for each row execute function public.enforce_late_fee_rules();
