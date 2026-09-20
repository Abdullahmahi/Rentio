-- Prompt 15 — the properties are in El Paso, Texas, not Mexico.
-- Addresses become US addresses. No business logic changes here.

-- `colonia` has no US equivalent; the field is now a second address line
-- ("Bldg C", "Suite 200").
alter table public.properties rename column colonia to address_line_2;
alter table public.settings   rename column colonia to address_line_2;

-- Existing rows carry Mexican state names. Nothing fits a 2-letter USPS code,
-- so they move to TX; prompt 20 reseeds this data with real El Paso addresses.
update public.properties set state = 'TX' where state is null or state !~ '^[A-Z]{2}$';
update public.settings   set state = 'TX' where state is null or state !~ '^[A-Z]{2}$';

alter table public.properties alter column state set default 'TX';
alter table public.settings   alter column state set default 'TX';

alter table public.properties
  add constraint properties_state_is_usps check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint properties_postal_code_is_zip check (postal_code is null or postal_code ~ '^\d{5}$');

-- `locale` gains a meaning for NULL: "this user has not chosen a language, so
-- use the default for the portal they are in" — English internally, Spanish in
-- the tenant portal. A value set by the user always wins.
alter table public.profiles alter column locale drop not null;
alter table public.profiles alter column locale drop default;
update public.profiles set locale = null;

comment on column public.profiles.locale is
  'User-chosen language. NULL means unset — the portal default applies.';
comment on column public.properties.address_line_2 is
  'Second address line: building, suite, or unit designator.';

-- A view keeps its own output column names, so both of these still published
-- `colonia` after the rename above.

drop view public.my_lease_details;
create view public.my_lease_details
with (security_invoker = false)
as
select
  l.id            as lease_id,
  u.id            as unit_id,
  u.unit_number,
  u.floor,
  u.bedrooms,
  u.bathrooms,
  u.sqm,
  p.name          as property_name,
  p.street,
  p.address_line_2,
  p.city,
  p.state,
  p.postal_code
from public.leases l
join public.units u      on u.id = l.unit_id
join public.properties p on p.id = u.property_id
where public.is_staff() or l.id in (select public.my_lease_ids());

grant select on public.my_lease_details to authenticated;

drop view public.public_settings;
create view public.public_settings
with (security_invoker = false)
as
select
  company_name,
  logo_url,
  bank_name,
  clabe,
  account_holder,
  invoice_prefix,
  street,
  address_line_2,
  city,
  state,
  postal_code,
  phone,
  email
from public.settings
limit 1;

grant select on public.public_settings to authenticated;
