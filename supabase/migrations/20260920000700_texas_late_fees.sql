-- Prompt 17 — Texas Property Code §92.019 constrains residential late fees.
--
-- Two rules the schema has to make it hard to break:
--   1. No late fee may be charged unless the rent is still unpaid at the END
--      OF THE SECOND FULL DAY after it was due. The minimum enforceable grace
--      period is therefore 2 days — never 0 and never 1.
--   2. A fee is PRESUMED reasonable at up to a percentage of one month's
--      rent: 12% for a dwelling in a structure of 4 or fewer units, 10% for a
--      structure with more than 4. A presumption is not an absolute ceiling,
--      so the app warns rather than blocks above it.

create type late_fee_type as enum ('fixed', 'percent');

-- ------------------------------------------------------------- properties

-- Nullable on purpose: when it is null the app derives the count from the
-- units on the property. A "property" in this app may be several separate
-- buildings, in which case the derivation is wrong and this is set by hand.
alter table public.properties
  add column units_in_structure int
    check (units_in_structure is null or units_in_structure > 0);

comment on column public.properties.units_in_structure is
  'Dwelling units in this physical structure. Sets the §92.019 late fee cap: '
  '12% at 4 or fewer, 10% above. NULL derives it from the unit count.';

-- ----------------------------------------------------------------- leases

alter table public.leases
  add column late_fee_type    late_fee_type not null default 'percent',
  add column late_fee_percent numeric(5,2) not null default 0
    check (late_fee_percent >= 0 and late_fee_percent <= 100),
  -- Set when a manager knowingly saves a fee above the presumed-reasonable
  -- cap. Without this the lease form refuses to save one.
  add column late_fee_over_cap_ack boolean not null default false;

-- Existing leases carry a flat fee and whatever grace period was typed in.
-- Convert them to a percentage of rent, clamped to the statutory presumption,
-- and lift every grace period to the legal minimum.
update public.leases
set late_fee_type = 'percent',
    late_fee_percent = least(
      round(case when rent_amount > 0
                 then (late_fee_amount / rent_amount) * 100
                 else 0 end, 2),
      10
    );

update public.leases set grace_days = 2 where grace_days < 2;

-- The backstop. A UI check alone is not enough for a legal constraint.
alter table public.leases
  add constraint leases_grace_days_texas_minimum check (grace_days >= 2);

comment on constraint leases_grace_days_texas_minimum on public.leases is
  'Texas Property Code §92.019: rent must be unpaid at the end of the second '
  'full day after the due date before a late fee may be charged.';

-- --------------------------------------------------------------- settings

alter table public.settings
  add column default_late_fee_percent numeric(5,2) not null default 10
    check (default_late_fee_percent >= 0 and default_late_fee_percent <= 100);

alter table public.settings drop column default_late_fee;

update public.settings set default_grace_days = greatest(default_grace_days, 2);

alter table public.settings
  add constraint settings_grace_days_texas_minimum check (default_grace_days >= 2);
