-- The recibo PDF prints the landlord's letterhead — company name, address and
-- bank details — and a tenant must be able to render their own receipt. The
-- address columns were missing from public_settings, so that block came out
-- blank for everyone.
--
-- None of this is sensitive: it is the business address already printed on the
-- receipt the tenant receives. `settings` itself stays staff-only.
--
-- New columns are appended, so `create or replace view` is valid here.

create or replace view public.public_settings
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
  colonia,
  city,
  state,
  postal_code,
  phone,
  email
from public.settings
limit 1;

grant select on public.public_settings to authenticated;
