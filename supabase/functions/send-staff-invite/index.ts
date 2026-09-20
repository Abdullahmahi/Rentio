/** Invites an admin or property manager. Admin only. */
import {
  corsHeaders, json, userClient, serviceClient, sendEmail, emailLayout,
} from "../_shared/common.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, full_name: fullName, role } = await request.json();
    if (!email || !role) return json({ error: "email and role are required" }, 400);
    if (role !== "admin" && role !== "manager") return json({ error: "invalid role" }, 400);

    // Only an admin may mint another staff account.
    const caller = userClient(request);
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const { data: profile } = await caller.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role !== "admin") return json({ error: "forbidden" }, 403);

    const service = serviceClient();
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const { data: settings } = await service.from("settings").select("company_name").maybeSingle();
    const company = settings?.company_name ?? "Rentio";

    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
      data: { full_name: fullName ?? null },
    });
    if (inviteError) throw inviteError;

    const userId = invited?.user?.id;
    if (!userId) throw new Error("could not resolve the invited user");

    const { error: profileError } = await service.from("profiles").upsert({
      // locale stays NULL so the internal portal's English default applies
      // until this person picks a language for themselves.
      id: userId, full_name: fullName ?? null, role, tenant_id: null,
    });
    if (profileError) throw profileError;

    await sendEmail({
      to: email,
      subject: `Acceso a ${company}`,
      html: emailLayout(
        `Te invitaron a ${company}`,
        `<p>Hola ${fullName ?? ""},</p>
         <p>Se creó tu cuenta con el rol de <strong>${role === "admin" ? "Administrador" : "Gerente de propiedades"}</strong>.</p>
         <p>Revisa tu correo para el enlace de acceso y establece tu contraseña.</p>`,
        company,
      ),
    }).catch((caught) => console.warn("staff invite email failed", caught));

    return json({ invited: true, user_id: userId });
  } catch (caught) {
    console.error("send-staff-invite", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
