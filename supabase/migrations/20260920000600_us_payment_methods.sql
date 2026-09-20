-- Prompt 16 — US payment rails.
--
-- SPEI, OXXO and CLABE are Mexican. Replace them with what an El Paso
-- landlord actually accepts, and REMOVE the bank fields rather than port
-- them: a full routing + account number published to 120 tenants in the
-- portal is an invitation to unauthorized ACH debits and check fraud. That
-- belongs behind a payment processor in Phase 2, not on a portal page.

-- ----------------------------------------------------------- payment_method

alter type payment_method rename to payment_method_mx;

create type payment_method as enum ('ach', 'zelle', 'check', 'money_order', 'cash', 'card', 'other');

alter table public.payments
  alter column method drop default,
  alter column method type payment_method
    using (case method::text
             when 'spei'     then 'ach'
             when 'efectivo' then 'cash'
             when 'deposito' then 'ach'
             when 'oxxo'     then 'money_order'
             when 'cheque'   then 'check'
             when 'tarjeta'  then 'card'
             else 'other'
           end)::payment_method,
  alter column method set default 'ach';

drop type payment_method_mx;

-- ------------------------------------------------------- payment instructions

-- public_settings still publishes the bank columns, so it has to go first.
drop view public.public_settings;

alter table public.settings
  drop column bank_name,
  drop column clabe,
  drop column account_holder,
  add column zelle_handle         text,
  add column check_payable_to     text,
  add column check_mailing_address text,
  add column dropoff_address      text,
  add column office_hours         text,
  add column payment_notes        text,
  add column nsf_fee              numeric(12,2) not null default 0;

comment on column public.settings.nsf_fee is
  'Returned payment (NSF) fee billed back on a bounced check or failed ACH.';

-- A bounced check has to be billable back to the tenant.
alter type line_category add value if not exists 'nsf_fee';

-- The tenant portal reads its payment instructions from here. Everything in
-- this view is information the landlord is deliberately handing to tenants;
-- `settings` itself stays staff-only.
create view public.public_settings
with (security_invoker = false)
as
select
  company_name,
  logo_url,
  invoice_prefix,
  street,
  address_line_2,
  city,
  state,
  postal_code,
  phone,
  email,
  zelle_handle,
  check_payable_to,
  check_mailing_address,
  dropoff_address,
  office_hours,
  payment_notes
from public.settings
limit 1;

grant select on public.public_settings to authenticated;
