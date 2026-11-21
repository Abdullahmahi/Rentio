/**
 * Server-only. The nightly pipeline, also run on demand from the
 * Automations page. Every step is idempotent, so running it twice is safe.
 *
 *  1. nightly() in SQL: draft each company's invoices on its chosen day,
 *     queue late-fee warnings (companies that switched them on).
 *  2. Email the queued late-fee warnings in the tenant's language.
 *  3. Queue rent reminders (per company: on/off and days before).
 *  4. "Send automatically": email the invoices drafted this run for
 *     companies that chose it.
 *  5. Drain the notifications outbox.
 *  6. One job_runs row per company, for the "Last run" panel.
 */
import type { Json } from "@/lib/database.types";
import { sendEmail, siteUrl } from "@/lib/server/email";
import { lateFeeWarningEmail } from "@/lib/server/late-fee-email";
import { drainNotifications } from "@/lib/server/notifications";
import { sendInvoiceEmail } from "@/lib/server/send-invoice-email";
import { clientFor, signJwt, type Db } from "@/lib/server/session";

interface OrgCounts {
  invoices_created: number;
  invoices_skipped: number;
  invoices_emailed: number;
  late_fee_warnings: number;
  rent_reminders: number;
  notifications_emailed: number;
  notifications_portal: number;
  errors: string[];
}

const empty = (): OrgCounts => ({
  invoices_created: 0,
  invoices_skipped: 0,
  invoices_emailed: 0,
  late_fee_warnings: 0,
  rent_reminders: 0,
  notifications_emailed: 0,
  notifications_portal: 0,
  errors: [],
});

/** A client that sees one company the way its first admin does; needed
 *  where RLS-scoped views (my_lease_details) would hide rows from the
 *  service role. */
async function adminClientFor(db: Db, orgId: string) {
  const { data: admin } = await db
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (!admin) return null;
  return clientFor(signJwt({ role: "authenticated", sub: admin.id, org_id: orgId }, 600));
}

export async function runAutomations(
  db: Db,
  trigger: "cron" | "manual",
  actorId: string | null = null,
) {
  const startedAt = new Date().toISOString();
  const perOrg = new Map<string, OrgCounts>();
  const counts = (orgId: string) => {
    let row = perOrg.get(orgId);
    if (!row) {
      row = empty();
      perOrg.set(orgId, row);
    }
    return row;
  };

  // 1. invoices + late-fee warning queue
  const { data: nightly, error: nightlyError } = await db.rpc("nightly");
  if (nightlyError) throw nightlyError;
  const summary = nightly as {
    orgs?: {
      org_id: string;
      invoices_created?: number;
      invoices_skipped?: number;
      invoice_ids?: string[];
      error?: string;
    }[];
  };
  for (const org of summary.orgs ?? []) {
    const row = counts(org.org_id);
    row.invoices_created += org.invoices_created ?? 0;
    row.invoices_skipped += org.invoices_skipped ?? 0;
    if (org.error) row.errors.push(`invoices: ${org.error}`);
  }

  // 2. late-fee warning emails
  const { data: pending, error: pendingError } = await db.rpc("late_fee_warnings_to_send");
  if (pendingError) throw pendingError;
  const portalUrl = siteUrl() ? `${siteUrl().replace(/\/$/, "")}/sign-in` : "";
  for (const warning of pending ?? []) {
    const channel = warning.tenant_email ? "email" : "portal";
    // Claim the row first, so two overlapping runs never email twice.
    const { data: claimed, error: claimError } = await db
      .from("late_fee_warnings")
      .update({ sent_at: new Date().toISOString(), channel })
      .eq("invoice_id", warning.invoice_id)
      .is("sent_at", null)
      .select("invoice_id");
    if (claimError) throw claimError;
    if (!claimed?.length) continue;
    const row = counts(warning.org_id);
    if (!warning.tenant_email) {
      row.late_fee_warnings += 1;
      continue;
    }
    try {
      const { subject, html } = lateFeeWarningEmail(warning, portalUrl);
      await sendEmail({ to: warning.tenant_email, subject, html });
      row.late_fee_warnings += 1;
    } catch (sendError) {
      // Release the claim: the next run tries again.
      console.error("late-fee warning email failed", warning.invoice_id, sendError);
      row.errors.push(`late-fee warning ${warning.invoice_id}: ${String(sendError)}`);
      await db
        .from("late_fee_warnings")
        .update({ sent_at: null, channel: null })
        .eq("invoice_id", warning.invoice_id);
    }
  }

  // 3. rent reminders (queued; counted per company below)
  const { error: remindersError } = await db.rpc("queue_rent_reminders");
  if (remindersError) throw remindersError;
  const { data: reminderRows } = await db
    .from("notifications")
    .select("org_id")
    .eq("kind", "rent_reminder")
    .gte("created_at", startedAt);
  for (const r of reminderRows ?? []) counts(r.org_id).rent_reminders += 1;

  // 4. send automatically
  const { data: autoSendOrgs } = await db
    .from("settings")
    .select("org_id")
    .eq("auto_invoice_send", true);
  const autoSend = new Set((autoSendOrgs ?? []).map((s) => s.org_id));
  for (const org of summary.orgs ?? []) {
    if (!autoSend.has(org.org_id) || !org.invoice_ids?.length) continue;
    const scoped = await adminClientFor(db, org.org_id);
    const row = counts(org.org_id);
    if (!scoped) {
      row.errors.push("send automatically: the company has no admin to send as");
      continue;
    }
    for (const invoiceId of org.invoice_ids) {
      try {
        await sendInvoiceEmail(scoped, org.org_id, invoiceId);
        row.invoices_emailed += 1;
      } catch (sendError) {
        row.errors.push(`invoice ${invoiceId}: ${String(sendError)}`);
      }
    }
  }

  // 5. the outbox
  const drained = await drainNotifications(db);
  for (const [orgId, c] of Object.entries(drained.per_org)) {
    const row = counts(orgId);
    row.notifications_emailed += c.emailed;
    row.notifications_portal += c.portal;
  }

  // 6. one row per active company, even a quiet one, so "Last run" is honest
  const { data: orgs } = await db.from("organizations").select("id").eq("status", "active");
  for (const org of orgs ?? []) counts(org.id);
  const finishedAt = new Date().toISOString();
  const rows = [...perOrg.entries()].map(([orgId, c]) => ({
    org_id: orgId,
    trigger,
    actor_id: actorId,
    started_at: startedAt,
    finished_at: finishedAt,
    summary: c as unknown as Json,
    error: c.errors.length ? c.errors.join("\n") : null,
  }));
  if (rows.length) {
    const { error: logError } = await db.from("job_runs").insert(rows);
    if (logError) console.error("job_runs insert failed", logError);
  }

  return { ...(nightly as object), started_at: startedAt, per_org: Object.fromEntries(perOrg) };
}
