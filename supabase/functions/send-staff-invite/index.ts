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

    // generateLink, never inviteUserByEmail — see send-tenant-invite for the
    // reasoning. This one was doubly wrong: it sent a Resend email saying
    // "check your email for the access link", where that link lived in a
    // SECOND email sent by Supabase's rate-limited SMTP. Two emails for one
    // job, and the one that mattered was the one that stops arriving. Now the
    // link is in the message we actually send.
    const { data: existingUsers } = await service.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(
      (candidate) => candidate.email?.toLowerCase() === String(email).toLowerCase(),
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
    const actionLink = link?.properties?.action_link ?? siteUrl;

    const { error: profileError } = await service.from("profiles").upsert({
      // locale stays NULL so the internal portal's English default applies
      // until this person picks a language for themselves.
      id: userId, full_name: fullName ?? null, role, tenant_id: null,
    });
    if (profileError) throw profileError;

    const roleLabel = role === "admin" ? "Administrator" : "Property manager";
    // As above: the account is already whole, so a delivery failure is
    // reported, not thrown.
    let emailed = true;
    try {
      await sendEmail({
        to: email,
        subject: `Your ${company} account`,
        html: emailLayout(
          `You have been invited to ${company}`,
          `<p>Hello ${fullName ?? ""},</p>
           <p>An account has been created for you with the role
              <strong>${roleLabel}</strong>. Choose a password to get started.</p>
           <p style="margin:20px 0"><a href="${actionLink}"
             style="display:inline-block;background:#1B4D3E;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
             Set my password</a></p>
           <p style="color:#6B655C">If you were not expecting this, ignore this message.</p>`,
          company,
        ),
      });
    } catch (caught) {
      emailed = false;
      console.warn("send-staff-invite: account created, email failed", caught);
    }

    return json({ invited: true, emailed, user_id: userId });
  } catch (caught) {
    console.error("send-staff-invite", caught);
    return json({ error: caught instanceof Error ? caught.message : "unknown error" }, 500);
  }
});
