/**
 * Server-only. Drains ONE company's public.notifications: claim, email in
 * the tenant's language, mark the channel. No address → 'portal' (the row
 * stays for the portal to show). A failed send releases the row for the
 * next run. Called right after a staff action (api.fn.send-notifications)
 * and by the nightly job as the backstop, so no extra cron is needed.
 * claim_notifications only ever returns rows of `orgId` (issue #13).
 */
import { sendEmail, siteUrl } from "@/lib/server/email";
import { notificationEmail, type NotificationRow } from "@/lib/server/notification-email";
import type { Db } from "@/lib/server/session";

export async function drainNotifications(db: Db, orgId: string) {
  if (!orgId) throw new Error("drainNotifications needs a company");
  const { data: rows, error } = await db.rpc("claim_notifications", {
    p_org_id: orgId,
    p_limit: 100,
  });
  if (error) throw error;

  const portalUrl = siteUrl() ? `${siteUrl().replace(/\/$/, "")}/sign-in` : "";
  let emailed = 0;
  let portalOnly = 0;
  const failed: string[] = [];

  for (const row of rows ?? []) {
    if (row.org_id !== orgId) continue; // the RPC already filters; belt and braces
    if (!row.tenant_email) {
      await db.rpc("notification_result", { p_id: row.id, p_channel: "portal" });
      portalOnly += 1;
      continue;
    }
    try {
      const { subject, html } = notificationEmail(row as NotificationRow, portalUrl);
      await sendEmail({ to: row.tenant_email, subject, html });
      await db.rpc("notification_result", { p_id: row.id, p_channel: "email" });
      emailed += 1;
    } catch (sendError) {
      console.error("notification email failed", row.id, row.kind, sendError);
      failed.push(row.id);
      await db.rpc("notification_result", { p_id: row.id, p_channel: null });
    }
  }
  return { emailed, portal_only: portalOnly, failed };
}
