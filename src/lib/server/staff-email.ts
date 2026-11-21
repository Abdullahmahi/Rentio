/**
 * Server-only. Best-effort email to a company's staff (money events: Stripe
 * connected/disconnected, a payment reversed). Never throws: the event is
 * already in activity_log, and a missing RESEND_API_KEY must not undo it.
 */
import { emailLayout, sendEmail } from "@/lib/server/email";
import type { Db } from "@/lib/server/session";

export async function emailStaff(
  db: Db,
  orgId: string,
  roles: ("admin" | "manager")[],
  title: string,
  bodyHtml: string,
  send: typeof sendEmail = sendEmail,
) {
  try {
    const [{ data: people, error }, { data: org }] = await Promise.all([
      db.from("profiles").select("email, role").eq("org_id", orgId).in("role", roles),
      db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ]);
    if (error) throw error;
    const html = emailLayout(title, bodyHtml, org?.name ?? "Rentio");
    let sent = 0;
    for (const person of people ?? []) {
      if (!person.email) continue;
      await send({ to: person.email, subject: title, html })
        .then(() => (sent += 1))
        .catch((caught: unknown) => console.warn("staff email", caught));
    }
    return sent;
  } catch (caught) {
    console.warn("staff email", caught);
    return 0;
  }
}
