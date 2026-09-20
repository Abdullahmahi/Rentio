-- Prompt 18 — Texas Property Code §92.103–92.109, security deposit returns.
--
-- The landlord must refund the deposit within 30 days after the tenant
-- surrenders the premises AND provides a forwarding address, and must deliver
-- an itemized list of any deductions. Retaining a deposit in bad faith
-- exposes the landlord to statutory penalties plus attorney's fees.
--
-- The two events are separate, and only the second starts the clock. Modelled
-- as a tracked obligation with a computed deadline, not a notes field.

alter table public.leases
  add column surrender_date                 date,
  add column forwarding_address             text,
  add column forwarding_address_received_at date,
  -- Generated, so the deadline cannot drift from the date that set it.
  add column deposit_due_date date
    generated always as (forwarding_address_received_at + 30) stored,
  add column deposit_settled_at date,
  add column deposit_itemization jsonb not null default '[]'::jsonb,
  add column move_out_notes text,
  -- The clock cannot start before the tenant has actually moved out.
  add constraint leases_forwarding_after_surrender check (
    forwarding_address_received_at is null
    or surrender_date is null
    or forwarding_address_received_at >= surrender_date
  );

comment on column public.leases.deposit_due_date is
  'Texas Property Code §92.103: 30 days after the forwarding address is '
  'received. Generated — never set this by hand.';
comment on column public.leases.deposit_itemization is
  'Array of {description, amount}. §92.104(c) requires an itemized list '
  'whenever any part of the deposit is withheld.';

create index on public.leases (deposit_due_date)
  where deposit_settled_at is null;

-- Deposits still owed, with the clock's current state. One place, so the
-- dashboard card and the compliance report cannot disagree.
create view public.deposit_obligations
with (security_invoker = true)
as
select
  l.id                as lease_id,
  l.unit_id,
  l.deposit_amount,
  l.surrender_date,
  l.forwarding_address,
  l.forwarding_address_received_at,
  l.deposit_due_date,
  l.deposit_settled_at,
  l.deposit_itemization,
  (l.deposit_due_date - current_date)                as days_remaining,
  (l.deposit_settled_at - l.forwarding_address_received_at) as days_taken,
  case
    when l.deposit_settled_at is not null
      then l.deposit_settled_at <= l.deposit_due_date
    else null
  end                                                as settled_on_time
from public.leases l
where l.surrender_date is not null;

grant select on public.deposit_obligations to authenticated;
