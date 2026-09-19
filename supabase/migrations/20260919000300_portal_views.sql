-- The tenant portal needs the tenant's OWN unit number and building address:
-- it is the payment reference on the Inicio screen and the whole of the
-- Contrato screen. `units` and `properties` stay staff-only per the spec, so
-- this security-definer view exposes exactly those columns, and only for
-- leases the caller is actually on.

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
  p.colonia,
  p.city,
  p.state,
  p.postal_code
from public.leases l
join public.units u      on u.id = l.unit_id
join public.properties p on p.id = u.property_id
-- Staff read everything; a tenant sees only the leases they are named on.
where public.is_staff() or l.id in (select public.my_lease_ids());

grant select on public.my_lease_details to authenticated;
