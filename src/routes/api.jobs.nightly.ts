import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { sendEmail, siteUrl } from "@/lib/server/email";
import { lateFeeWarningEmail } from "@/lib/server/late-fee-email";
import { drainNotifications } from "@/lib/server/notifications";
import { fail, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Constant-time compare; hashing first evens out the lengths. */
function secretMatches(given: string | null) {
  const expected = process.env["CRON_SECRET"] ?? "";
  if (expected.length < 16 || !given) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The scheduled entry point (execution.md A1). Coolify runs it daily:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/jobs/nightly
 *
 * 1. `nightly()` in SQL: draft invoices for the El Paso month (on the 1st,
 *    or whenever a company has none yet) and queues late-fee warnings.
 * 2. Emails each queued warning in the tenant's language, then marks it
 *    sent. No address: marked `portal` (the portal shows it).
 *
 * Every step is idempotent, so a second call does nothing.
 */
export const Route = createFileRoute("/api/jobs/nightly")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!secretMatches(request.headers.get("x-cron-secret")))
          return json({ error: "unauthorized" }, 401);

        try {
          const db = serviceDb();
          const { data: counts, error } = await db.rpc("nightly");
          if (error) throw error;

          const { data: pending, error: pendingError } = await db.rpc("late_fee_warnings_to_send");
          if (pendingError) throw pendingError;

          const portalUrl = siteUrl() ? `${siteUrl().replace(/\/$/, "")}/sign-in` : "";
          let emailed = 0;
          let portalOnly = 0;
          const failed: string[] = [];

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

            if (!warning.tenant_email) {
              portalOnly += 1;
              continue;
            }
            try {
              const { subject, html } = lateFeeWarningEmail(warning, portalUrl);
              await sendEmail({ to: warning.tenant_email, subject, html });
              emailed += 1;
            } catch (sendError) {
              // Release the claim: tomorrow's run tries again.
              console.error("late-fee warning email failed", warning.invoice_id, sendError);
              failed.push(warning.invoice_id);
              await db
                .from("late_fee_warnings")
                .update({ sent_at: null, channel: null })
                .eq("invoice_id", warning.invoice_id);
            }
          }

          // Rent reminders for invoices due within 3 days, then the outbox
          // backstop: anything a staff action queued but didn't drain.
          const { data: reminders, error: remindersError } = await db.rpc("queue_rent_reminders");
          if (remindersError) throw remindersError;
          const notifications = await drainNotifications(db);

          const summary = {
            ...(counts as object),
            emailed,
            portal_only: portalOnly,
            failed,
            rent_reminders: reminders ?? 0,
            notifications,
          };
          console.info("nightly", JSON.stringify(summary));
          return json(summary);
        } catch (caught) {
          return fail(caught, "nightly");
        }
      },
    },
  },
});
