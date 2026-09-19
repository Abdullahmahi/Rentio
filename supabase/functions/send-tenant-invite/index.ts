/**
 * Invites a tenant to the portal: creates the auth user, links
 * profiles.tenant_id, and emails a Spanish invitation with a set-password
 * link. Staff only — creating auth users needs the service role.
 */
import {
  corsHeaders, json, userClient, requireStaff, serviceClient, sendEmail, emailLayout,
} from "../_shared/common.ts";

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
        subject: `Acceso a tu portal de inquilino — ${company}`,
        html: emailLayout(
          "Tu portal de inquilino",
          `<p>Hola ${fullName ?? ""},</p>
           <p>Ya puedes entrar a tu portal para consultar tus recibos, tu contrato y reportar pagos.</p>
           <p style="margin:24px 0"><a href="${link.properties?.action_link ?? siteUrl}"
             style="display:inline-block;background:#1B4D3E;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
             Establecer mi contraseña</a></p>
           <p style="color:#6B655C">Si no solicitaste este acceso, puedes ignorar este mensaje.</p>`,
          company,
        ),
      });
    }

    if (!userId) throw new Error("could not resolve the invited user");

    // Link the login to the tenant record — this is what my_lease_ids() uses.
    const { error: profileError } = await service.from("profiles").upsert({
      id: userId, full_name: fullName ?? null, role: "tenant", tenant_id: tenantId, locale: "es-MX",
    });
    if (profileError) throw profileError;

    return json({ invited: true, user_id: userId });
  } catch (caught) {
    console.error("send-tenant-invite", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
