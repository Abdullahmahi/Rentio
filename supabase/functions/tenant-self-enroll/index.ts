/**
 * Lets a tenant the landlord has already added claim their own portal login.
 *
 * This is the ONE function in this project that an anonymous caller can reach,
 * so the rules it plays by matter:
 *
 *   - It NEVER returns whether the address matched. Same response, same shape,
 *     AND the same timing, every time. An endpoint that says "no such tenant"
 *     is a list of who rents from this landlord, readable by anyone — and so
 *     is one that merely takes three seconds longer when the answer is yes.
 *     The reply is sent before any lookup starts; the work runs after it, via
 *     EdgeRuntime.waitUntil.
 *   - It NEVER returns tenant data. The only side effect a caller can cause is
 *     an email to an address that was already on a lease.
 *   - It only ever enrols someone already present in `tenants` AND named on a
 *     lease. It cannot create a tenant, and it cannot grant staff access:
 *     the role is hard-coded to 'tenant' here, never taken from the request.
 *   - An address that already has a login gets an ordinary password-recovery
 *     link, not a fresh invite, so this cannot be used to take over an
 *     account. Either way the link goes to the mailbox, not to the caller.
 */
import {
  corsHeaders, json, serviceClient, sendEmail, emailLayout,
} from "../_shared/common.ts";

/** English above, Spanish below — same reasoning as the staff-sent invite. */
function enrollBody(fullName: string | null, actionLink: string) {
  const button = (label: string) =>
    `<p style="margin:20px 0"><a href="${actionLink}"
       style="display:inline-block;background:#1B4D3E;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
       ${label}</a></p>`;
  return `<p>Hello ${fullName ?? ""},</p>
     <p>Someone asked to set up portal access for this address. If that was you,
        choose a password and you can see your receipts and your lease, and
        report a payment.</p>
     ${button("Set my password")}
     <p style="color:#6B655C">If it was not you, ignore this message — nothing has changed.</p>
     <hr style="border:none;border-top:1px solid #E7E3DD;margin:24px 0" />
     <p>Hola ${fullName ?? ""},</p>
     <p>Alguien solicitó acceso al portal para este correo. Si fuiste tú, elige
        una contraseña y podrás ver tus recibos, tu contrato y reportar pagos.</p>
     ${button("Establecer mi contraseña")}
     <p style="color:#6B655C">Si no fuiste tú, ignora este mensaje — nada ha cambiado.</p>`;
}

/** Everything that could reveal whether the address matched. Runs AFTER the
 *  response has already gone out, so none of it is observable in the timing. */
async function enroll(address: string) {
  try {
    const service = serviceClient();
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const { data: settings } = await service.from("settings").select("company_name").maybeSingle();
    const company = settings?.company_name ?? "Rentio";

    // Must already be a tenant. ilike so a capitalised address still matches.
    const { data: tenant } = await service
      .from("tenants")
      .select("id, full_name, email")
      .ilike("email", address)
      .maybeSingle();
    if (!tenant) return;

    // ...and actually on a lease. A tenant record with no lease is a contact,
    // not somebody who should be reading a portal.
    const { count: leaseCount } = await service
      .from("lease_tenants")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);
    if (!leaseCount) return;

    // Already claimed? Send recovery instead of a second invite.
    const { data: existingProfile } = await service
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    // generateLink, not inviteUserByEmail. Both create the user, but invite
    // sends through Supabase's built-in SMTP, which is rate limited to a
    // handful of messages an hour and is documented as not for production —
    // it returns over_email_send_rate_limit and the account is never created.
    // generateLink only mints the link; we deliver it through Resend, which
    // this project already uses for every other email it sends.
    const { data: link, error: linkError } = await service.auth.admin.generateLink(
      existingProfile
        ? { type: "recovery", email: address, options: { redirectTo: `${siteUrl}/reset-password` } }
        : {
            type: "invite",
            email: address,
            options: {
              redirectTo: `${siteUrl}/reset-password`,
              data: { full_name: tenant.full_name },
            },
          },
    );
    if (linkError || !link?.properties?.action_link) {
      console.error("tenant-self-enroll: could not mint a link", linkError);
      return;
    }

    if (!existingProfile) {
      const userId = link.user?.id;
      if (!userId) return;
      // role is fixed here, never read from the request body.
      await service.from("profiles").upsert({
        id: userId,
        full_name: tenant.full_name,
        role: "tenant",
        tenant_id: tenant.id,
      });
    }

    await sendEmail({
      to: address,
      subject: `Your tenant portal · Tu portal de inquilino — ${company}`,
      html: emailLayout(
        "Your tenant portal · Tu portal de inquilino",
        enrollBody(tenant.full_name, link.properties.action_link),
        company,
      ),
    });
  } catch (caught) {
    // Log for us. The caller already has its answer and learns nothing.
    console.error("tenant-self-enroll", caught);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let address: string | null = null;
  try {
    const { email } = await request.json();
    if (typeof email === "string" && email.includes("@")) address = email.trim().toLowerCase();
  } catch {
    address = null;
  }

  if (address) {
    // Deliberately not awaited. The response below goes out first.
    const work = enroll(address);
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
    else void work;
  }

  // Always the same body, whatever happened. Callers learn nothing.
  return json({ ok: true });
});
