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

    // inviteUserByEmail both creates the user and mints the set-password link.
    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
      data: { full_name: fullName ?? null },
    });

    let userId = invited?.user?.id;

    // Already registered: fall back to a recovery link rather than failing.
    if (inviteError) {
      const { data: list } = await service.auth.admin.listUsers();
      const existing = list?.users?.find((user) => user.email?.toLowerCase() === String(email).toLowerCase());
      if (!existing) throw inviteError;
      userId = existing.id;

      const { data: link, error: linkError } = await service.auth.admin.generateLink({
        type: "recovery", email, options: { redirectTo: `${siteUrl}/reset-password` },
      });
      if (linkError) throw linkError;

      await sendEmail({
        to: email,
        subject: `Your tenant portal · Tu portal de inquilino — ${company}`,
        html: emailLayout(
          "Your tenant portal · Tu portal de inquilino",
          inviteBody(fullName, link.properties?.action_link ?? siteUrl),
          company,
        ),
      });
    }

    if (!userId) throw new Error("could not resolve the invited user");

    // Link the login to the tenant record — this is what my_lease_ids() uses.
    const { error: profileError } = await service.from("profiles").upsert({
      // locale stays NULL: the tenant portal already defaults to Spanish, and
      // a NULL here means "the tenant has not chosen", so their own pick wins.
      id: userId, full_name: fullName ?? null, role: "tenant", tenant_id: tenantId,
    });
    if (profileError) throw profileError;

    return json({ invited: true, user_id: userId });
  } catch (caught) {
    console.error("send-tenant-invite", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
