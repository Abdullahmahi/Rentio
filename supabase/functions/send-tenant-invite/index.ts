/**
 * Invites a tenant to the portal: creates the auth user, links
 * profiles.tenant_id, and emails a bilingual invitation (English above,
 * Spanish below) with a set-password link. Staff only — creating auth users
 * needs the service role.
 */
import {
  corsHeaders, json, userClient, requireStaff, serviceClient, sendEmail, emailLayout,
} from "../_shared/common.ts";

/** English above, Spanish below — most El Paso tenants prefer Spanish, but the
 *  invitation is the one email that has to be readable either way. */
function inviteBody(fullName: string | null | undefined, actionLink: string) {
  const button = (label: string) =>
    `<p style="margin:20px 0"><a href="${actionLink}"
       style="display:inline-block;background:#1B4D3E;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
       ${label}</a></p>`;
  return `<p>Hello ${fullName ?? ""},</p>
     <p>Your tenant portal is ready. You can view your receipts and your lease, and report a payment.</p>
     ${button("Set my password")}
     <p style="color:#6B655C">If you did not expect this, you can ignore this message.</p>
     <hr style="border:none;border-top:1px solid #E7E3DD;margin:24px 0" />
     <p>Hola ${fullName ?? ""},</p>
     <p>Ya puedes entrar a tu portal para consultar tus recibos, tu contrato y reportar pagos.</p>
     ${button("Establecer mi contraseña")}
     <p style="color:#6B655C">Si no solicitaste este acceso, puedes ignorar este mensaje.</p>`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tenant_id: tenantId, email, full_name: fullName } = await request.json();
    if (!tenantId || !email) return json({ error: "tenant_id and email are required" }, 400);

    const caller = userClient(request);
    const { isStaff } = await requireStaff(caller);
    if (!isStaff) return json({ error: "forbidden" }, 403);

    const service = serviceClient();
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const { data: settings } = await service.from("settings").select("company_name").maybeSingle();
    const company = settings?.company_name ?? "Rentio";

    // generateLink, never inviteUserByEmail.
    //
    // invite sends through Supabase's built-in SMTP, which is rate limited to
    // a handful of messages an hour and is documented as not for production.
    // It had already started returning over_email_send_rate_limit here, and
    // when it does the account is not created at all — the invite simply
    // stops working, silently, after the first couple. generateLink only
    // mints the link; Resend delivers it, as it does for every other email
    // this project sends.
    //
    // An address that already has a login gets recovery instead, so
    // re-inviting an existing tenant is safe rather than an error.
    const { data: existingUsers } = await service.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(
      (user) => user.email?.toLowerCase() === String(email).toLowerCase(),
    );

    const { data: link, error: linkError } = await service.auth.admin.generateLink(
      existing
        ? { type: "recovery", email, options: { redirectTo: `${siteUrl}/activate` } }
        : {
            type: "invite",
            email,
            options: { redirectTo: `${siteUrl}/activate`, data: { full_name: fullName ?? null } },
          },
    );
    if (linkError) throw linkError;

    const userId = existing?.id ?? link?.user?.id;
    if (!userId) throw new Error("could not resolve the invited user");

    // The profile comes BEFORE the email, deliberately. generateLink has
    // already created the auth user, so a send failure here would otherwise
    // leave a login with no profile — it authenticates, resolves no role and
    // lands on a blank portal, which is indistinguishable from the app being
    // broken. Get the account whole first; a failed email can be retried and
    // now takes the recovery path.
    const { error: profileError } = await service.from("profiles").upsert({
      // locale stays NULL: the tenant portal already defaults to Spanish, and
      // a NULL here means "the tenant has not chosen", so their own pick wins.
      id: userId, full_name: fullName ?? null, role: "tenant", tenant_id: tenantId,
    });
    if (profileError) throw profileError;

    // A delivery failure must not read as "nothing happened" — the account
    // exists either way, and reporting failure would have staff invite the
    // same person again. Same call the receipts page makes: do the work, say
    // whether the email went, let the operator decide. Resend refuses
    // example.com and any address outside the account owner's until a
    // sending domain is verified.
    let emailed = true;
    try {
      await sendEmail({
        to: email,
        subject: `Your tenant portal · Tu portal de inquilino — ${company}`,
        html: emailLayout(
          "Your tenant portal · Tu portal de inquilino",
          inviteBody(fullName, link.properties?.action_link ?? siteUrl),
          company,
        ),
      });
    } catch (caught) {
      emailed = false;
      console.warn("send-tenant-invite: account created, email failed", caught);
    }

    return json({ invited: true, emailed, user_id: userId });
  } catch (caught) {
    console.error("send-tenant-invite", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
