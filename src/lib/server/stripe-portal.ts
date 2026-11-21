/**
 * Server-only. What the portal routes need to charge a tenant on the
 * company's connected account: the account itself, the open invoices read
 * as the tenant, and the tenant's Stripe Customer.
 */
import type Stripe from "stripe";
import type { TablesInsert } from "@/lib/database.types";
import { serviceDb, type Db, type Session } from "@/lib/server/session";

/**
 * Save the caller's autopay method for a lease. One enrollment per lease,
 * and it belongs to the tenant who made it: a co-tenant cannot replace
 * another tenant's saved method (security review on #72). Null when the
 * lease's enrollment is someone else's.
 */
export async function saveEnrollment(
  db: Db,
  row: TablesInsert<"autopay_enrollments"> & { lease_id: string; tenant_id: string },
) {
  const { data: existing, error: readError } = await db
    .from("autopay_enrollments")
    .select("id, tenant_id")
    .eq("lease_id", row.lease_id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing && existing.tenant_id !== row.tenant_id) return null;
  if (existing) {
    const { data, error } = await db
      .from("autopay_enrollments")
      .update(row)
      .eq("id", existing.id)
      .eq("tenant_id", row.tenant_id)
      .select("*");
    if (error) throw error;
    return data?.[0] ?? null;
  }
  const { data, error } = await db.from("autopay_enrollments").insert(row).select("*");
  if (error?.code === "23505") return null; // a co-tenant enrolled a moment ago
  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * The company's connected account, when it can take charges. Tenants cannot
 * read stripe_accounts (RLS); the org comes from the caller's session, so the
 * service connection is filtered by a trusted id.
 */
export async function connectedAccount(orgId: string) {
  const { data, error } = await serviceDb()
    .from("stripe_accounts")
    .select("stripe_account_id, charges_enabled, card_fee_enabled, card_fee_percent")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.stripe_account_id || !data.charges_enabled) return null;
  return { ...data, stripe_account_id: data.stripe_account_id };
}

/**
 * Open, non-draft invoices on a lease the caller may see, oldest first, with
 * their balances. Read AS THE CALLER: a tenant gets their own lease, no
 * drafts (20261111000100). Null when the lease is not theirs.
 */
export async function openInvoices(session: Session, leaseId: string) {
  const { data: lease } = await session.db
    .from("leases")
    .select("id")
    .eq("id", leaseId)
    .maybeSingle();
  if (!lease) return null;
  const [{ data: invoices, error: invoicesError }, { data: balances, error: balancesError }] =
    await Promise.all([
      session.db
        .from("invoices")
        .select("id, status, due_date")
        .eq("lease_id", leaseId)
        .not("status", "in", "(cancelado,borrador)")
        .order("due_date"),
      session.db.from("invoice_balances").select("invoice_id, balance").eq("lease_id", leaseId),
    ]);
  if (invoicesError) throw invoicesError;
  if (balancesError) throw balancesError;
  const balance = new Map(
    (balances ?? []).map((row) => [row.invoice_id, Number(row.balance ?? 0)]),
  );
  return (invoices ?? [])
    .map((invoice) => ({ id: invoice.id, balance: balance.get(invoice.id) ?? 0 }))
    .filter((invoice) => invoice.balance > 0.005);
}

/** The tenant's Customer on the connected account, created on first use. */
export async function customerFor(
  stripe: Stripe,
  session: Session,
  stripeAccount: string,
  tenantId: string,
) {
  const orgId = session.profile.org_id!;
  const service = serviceDb();
  const { data: existing } = await service
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("org_id", orgId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing) return existing.stripe_customer_id;

  const { data: tenant } = await session.db
    .from("tenants")
    .select("full_name, email")
    .eq("id", tenantId)
    .maybeSingle();
  const customer = await stripe.customers.create(
    {
      ...(tenant?.full_name ? { name: tenant.full_name } : {}),
      ...(tenant?.email ? { email: tenant.email } : {}),
      metadata: { org_id: orgId, tenant_id: tenantId },
    },
    { stripeAccount },
  );
  const { error } = await service
    .from("stripe_customers")
    .insert({ org_id: orgId, tenant_id: tenantId, stripe_customer_id: customer.id });
  if (error) {
    // Lost a race with a parallel first payment: keep the one that won.
    const { data: winner } = await service
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("org_id", orgId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (winner) return winner.stripe_customer_id;
    throw error;
  }
  return customer.id;
}
