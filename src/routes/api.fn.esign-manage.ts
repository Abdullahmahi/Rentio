import { createFileRoute } from "@tanstack/react-router";
import { LINK_DAYS, signLink } from "@/lib/esign";
import { siteUrl } from "@/lib/server/email";
import { companyName, emailSigningLink, newToken } from "@/lib/server/esign";
import { fail, requireSession } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Staff actions on a sent agreement, through the caller's client (RLS):
 *   { action: "resend", signer_id }  new link (the old one stops working),
 *                                    14 more days, emailed again
 *   { action: "void", request_id }   cancels it; links stop working
 */
export const Route = createFileRoute("/api/fn/esign-manage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!session.isStaff || !orgId) return json({ error: "forbidden" }, 403);
        const db = session.db;

        try {
          const body = (await request.json()) as {
            action?: string;
            signer_id?: string;
            request_id?: string;
          };

          if (body.action === "void" && body.request_id) {
            const { data, error } = await db
              .from("signature_requests")
              .update({ status: "voided", voided_at: new Date().toISOString() })
              .eq("id", body.request_id)
              .eq("status", "sent")
              .select("id, lease_id");
            if (error) throw error;
            if (!data.length)
              return json({ error: "This agreement can no longer be cancelled" }, 409);
            await db.from("activity_log").insert({
              actor_id: session.profile.id,
              entity_type: "lease",
              entity_id: data[0]!.lease_id,
              action: "esign_void",
              meta: { request_id: body.request_id },
            });
            return json({ voided: true });
          }

          if (body.action === "resend" && body.signer_id) {
            const { data: signer } = await db
              .from("signature_signers")
              .select("id, request_id, name, email, locale, signed_at")
              .eq("id", body.signer_id)
              .maybeSingle();
            if (!signer) return json({ error: "not found" }, 404);
            const { data: agreement } = await db
              .from("signature_requests")
              .select("id, title, message, status")
              .eq("id", signer.request_id)
              .single();
            if (signer.signed_at || agreement?.status !== "sent")
              return json({ error: "Nothing to resend: already signed or closed" }, 409);

            const { token, hash } = newToken();
            const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
            const { error } = await db
              .from("signature_signers")
              .update({ token_hash: hash, token_expires_at: expiresAt })
              .eq("id", signer.id);
            if (error) throw error;
            // Expiry is per agreement too: a reminder keeps the whole thing open.
            await db
              .from("signature_requests")
              .update({ expires_at: expiresAt })
              .eq("id", agreement.id)
              .lt("expires_at", expiresAt);

            const emailed = await emailSigningLink({
              to: signer.email,
              name: signer.name,
              locale: signer.locale,
              company: await companyName(orgId),
              title: agreement.title,
              token,
              expiresAt,
              message: agreement.message,
            });
            if (emailed)
              await db
                .from("signature_signers")
                .update({ emailed_at: new Date().toISOString() })
                .eq("id", signer.id);
            return json({ emailed, link: signLink(siteUrl(), token) });
          }

          return json({ error: "unknown action" }, 400);
        } catch (caught) {
          return fail(caught, "esign-manage");
        }
      },
    },
  },
});
