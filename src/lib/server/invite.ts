/**
 * Server-only. Gives someone access: a profile row waiting for their login,
 * and an email with the link to create it.
 *
 * Clerk owns logins, so nothing here creates one. The profile carries the
 * email; the first time that person signs in with a Clerk-verified copy of
 * the address, session.ts links the two. Re-inviting is safe: an existing
 * profile in this org is updated, and the email simply goes out again.
 */
import { button, emailLayout, escapeHtml, sendEmail, siteUrl } from "@/lib/server/email";
import { ilikeLiteral, type Session } from "@/lib/server/session";

type InviteRole = "admin" | "manager" | "tenant";

export async function invite(
  session: Session,
  {
    email,
    fullName,
    role,
    tenantId,
  }: { email: string; fullName: string | null; role: InviteRole; tenantId: string | null },
) {
  const db = session.db;
  const address = email.trim().toLowerCase();

  // Written through the caller's client: RLS keeps it in their org, and the
  // profiles trigger refuses a non-admin minting anything but a tenant.
  const { data: existing, error: findError } = await db
    .from("profiles")
    .select("id")
    .ilike("email", ilikeLiteral(address))
    .maybeSingle();
  if (findError) throw findError;

  const fields = { full_name: fullName, role, tenant_id: tenantId };
  const { error } = existing
    ? await db.from("profiles").update(fields).eq("id", existing.id)
    : await db
        .from("profiles")
        .insert({ ...fields, email: address, org_id: session.profile.org_id });
  if (error) {
    // The unique email index, hit by a profile in another organization.
    if (/duplicate key/i.test(error.message))
      throw new Error("This email already has an account with another company");
    throw error;
  }

  const { data: settings } = await db.from("settings").select("company_name").maybeSingle();
  const company = settings?.company_name ?? "Rentio";
  const link = `${siteUrl()}/activate?email=${encodeURIComponent(address)}`;
  const name = escapeHtml(fullName);

  // The access exists either way; only delivery can fail. Report it rather
  // than throwing, or staff invite the same person twice.
  let emailed = true;
  try {
    if (role === "tenant") {
      // English above, Spanish below: the one email that has to be readable either way.
      await sendEmail({
        to: address,
        subject: `Your tenant portal · Tu portal de inquilino — ${company}`,
        html: emailLayout(
          "Your tenant portal · Tu portal de inquilino",
          `<p>Hello ${name},</p>
           <p>Your tenant portal is ready. You can view your receipts and your lease, and report a payment.</p>
           ${button(link, "Set up my login")}
           <p style="color:#6B655C">If you did not expect this, you can ignore this message.</p>
           <hr style="border:none;border-top:1px solid #E7E3DD;margin:24px 0" />
           <p>Hola ${name},</p>
           <p>Ya puedes entrar a tu portal para consultar tus recibos, tu contrato y reportar pagos.</p>
           ${button(link, "Crear mi acceso")}
           <p style="color:#6B655C">Si no solicitaste este acceso, puedes ignorar este mensaje.</p>`,
          company,
        ),
      });
    } else {
      await sendEmail({
        to: address,
        subject: `Your ${company} account`,
        html: emailLayout(
          `You have been invited to ${escapeHtml(company)}`,
          `<p>Hello ${name},</p>
           <p>You have been given access with the role
              <strong>${role === "admin" ? "Administrator" : "Property manager"}</strong>.
              Sign up with this email address to get started.</p>
           ${button(link, "Set up my login")}
           <p style="color:#6B655C">If you were not expecting this, ignore this message.</p>`,
          company,
        ),
      });
    }
  } catch (caught) {
    emailed = false;
    console.warn("invite: access granted, email failed", caught);
  }
  return { invited: true, emailed };
}
