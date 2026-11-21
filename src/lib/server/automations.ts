/**
 * Server-only. The nightly pipeline, also run on demand from the
 * Automations page. Every step is idempotent, so running it twice is safe.
 *
 * It always runs for ONE company: runAutomations(db, orgId, …) filters every
 * query and RPC to that company, so "Run now" in company A can never draft,
 * queue, claim or email anything of company B (issue #13). The cron loops
 * the active companies with runAllAutomations.
 *
 *  1. nightly(org) in SQL: draft the company's invoices on its chosen day,
 *     queue its late-fee warnings (if switched on).
 *  2. Email the queued late-fee warnings in the tenant's language.
 *  3. Queue rent reminders (on/off and days before).
 *  4. "Send automatically": email the invoices drafted this run, if chosen.
 *  5. Drain the company's notifications outbox.
 *  6. One job_runs row for the company, for the "Last run" panel.
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

const message = (caught: unknown) =>
  caught instanceof Error
    ? caught.message
    : typeof caught === "object" && caught && "message" in caught
      ? String((caught as { message: unknown }).message)
      : String(caught);

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

/**
 * One company's run. Never throws: a failure is recorded on the company's
 * job_runs row and in the returned `errors`, so the cron can move on.
 */
export async function runAutomations(
  db: Db,
  orgId: string,
  trigger: "cron" | "manual",
  actorId: string | null = null,
) {
  if (!orgId) throw new Error("runAutomations needs a company");
  const startedAt = new Date().toISOString();
  const row = empty();
  let today: string | null = null;

  try {
    // 1. invoices + late-fee warning queue
    const { data, error: nightlyError } = await db.rpc("nightly", { p_org_id: orgId });
    if (nightlyError) throw nightlyError;
    const summary = data as {
      today?: string;
      orgs?: {
        org_id: string;
        invoices_created?: number;
        invoices_skipped?: number;
        invoice_ids?: string[];
        error?: string;
      }[];
    };
    today = summary.today ?? null;
    const mine = (summary.orgs ?? []).find((org) => org.org_id === orgId);
    row.invoices_created = mine?.invoices_created ?? 0;
    row.invoices_skipped = mine?.invoices_skipped ?? 0;
    if (mine?.error) row.errors.push(`invoices: ${mine.error}`);

    // 2. late-fee warning emails
    const { data: pending, error: pendingError } = await db.rpc("late_fee_warnings_to_send", {
      p_org_id: orgId,
    });
    if (pendingError) throw pendingError;
    const portalUrl = siteUrl() ? `${siteUrl().replace(/\/$/, "")}/sign-in` : "";
    for (const warning of pending ?? []) {
      if (warning.org_id !== orgId) continue; // the RPC already filters; belt and braces
      const channel = warning.tenant_email ? "email" : "portal";
      // Claim the row first, so two overlapping runs never email twice.
      const { data: claimed, error: claimError } = await db
        .from("late_fee_warnings")
        .update({ sent_at: new Date().toISOString(), channel })
        .eq("invoice_id", warning.invoice_id)
        .eq("org_id", orgId)
        .is("sent_at", null)
        .select("invoice_id");
      if (claimError) throw claimError;
      if (!claimed?.length) continue;
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
        row.errors.push(`late-fee warning ${warning.invoice_id}: ${message(sendError)}`);
        await db
          .from("late_fee_warnings")
          .update({ sent_at: null, channel: null })
          .eq("invoice_id", warning.invoice_id)
          .eq("org_id", orgId);
      }
    }

    // 3. rent reminders (queued here, emailed by the outbox in step 5)
    const { data: reminders, error: remindersError } = await db.rpc("queue_rent_reminders", {
      p_org_id: orgId,
    });
    if (remindersError) throw remindersError;
    row.rent_reminders = reminders ?? 0;

    // 4. send automatically
    const invoiceIds = mine?.invoice_ids ?? [];
    if (invoiceIds.length) {
      const { data: settings } = await db
        .from("settings")
        .select("auto_invoice_send")
        .eq("org_id", orgId)
        .maybeSingle();
      if (settings?.auto_invoice_send) {
        const scoped = await adminClientFor(db, orgId);
        if (!scoped) row.errors.push("send automatically: the company has no admin to send as");
        for (const invoiceId of scoped ? invoiceIds : []) {
          try {
            await sendInvoiceEmail(scoped!, orgId, invoiceId);
            row.invoices_emailed += 1;
          } catch (sendError) {
            row.errors.push(`invoice ${invoiceId}: ${message(sendError)}`);
          }
        }
      }
    }

    // 5. this company's outbox
    const drained = await drainNotifications(db, orgId);
    row.notifications_emailed = drained.emailed;
    row.notifications_portal = drained.portal_only;
  } catch (caught) {
    console.error("automations failed", orgId, caught);
    row.errors.push(message(caught));
  }

  // 6. one row for this company, even a quiet run, so "Last run" is honest
  const { error: logError } = await db.from("job_runs").insert({
    org_id: orgId,
    trigger,
    actor_id: actorId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    summary: row as unknown as Json,
    error: row.errors.length ? row.errors.join("\n") : null,
  });
  if (logError) console.error("job_runs insert failed", orgId, logError);

  return { started_at: startedAt, today, ...row };
}

/**
 * The nightly cron: every active company, one after another, each with its
 * own settings. runAutomations never throws, so one company's failure lands
 * on its own job_runs row and the loop moves on.
 */
export async function runAllAutomations(db: Db) {
  const startedAt = new Date().toISOString();
  const { data: orgs, error } = await db.from("organizations").select("id").eq("status", "active");
  if (error) throw error;
  const perOrg: Record<string, Awaited<ReturnType<typeof runAutomations>>> = {};
  // ponytail: sequential; run a few companies in parallel if 200+ makes the night long.
  for (const org of orgs ?? []) {
    try {
      perOrg[org.id] = await runAutomations(db, org.id, "cron");
    } catch (caught) {
      console.error("nightly: company failed", org.id, caught);
    }
  }
  const failed = Object.entries(perOrg)
    .filter(([, counts]) => counts.errors.length)
    .map(([id]) => id);
  return {
    started_at: startedAt,
    orgs: (orgs ?? []).length,
    orgs_with_errors: failed,
    per_org: perOrg,
  };
}
