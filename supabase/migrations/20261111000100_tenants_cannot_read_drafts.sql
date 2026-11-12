-- Tenants must not see draft invoices. The nightly job drafts the month on
-- the 1st for staff review; until staff send it, the tenant has nothing to
-- pay. lease_balances and invoice_balances are security_invoker views, so
-- this one policy also removes drafts from the tenant's balance and "Due on".

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    public.is_staff()
    or (lease_id in (select public.my_lease_ids()) and status <> 'borrador')
  );
