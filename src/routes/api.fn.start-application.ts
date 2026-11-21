import { createFileRoute } from "@tanstack/react-router";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { fail, forgetProfile, ilikeLiteral, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * A prospect opened /apply/<org-slug>?link=<token> and signed in. Gives the
 * login an `applicant` profile in the link's company and opens (or reuses)
 * their draft application. Uses Clerk's auth() directly because
 * requireSession refuses a login that has no profile yet, which is exactly
 * this caller.
 *
 * Trust: the org and unit come from the link row, the email from Clerk's
 * verified addresses, the role is hard-coded. profiles.email is unique
 * platform-wide, so one email is one account: an email that already
 * belongs to staff or a tenant (here or in another company) is refused.
 */
export const Route = createFileRoute("/api/fn/start-application")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Same cross-site refusal as requireSession.
        const origin = request.headers.get("origin");
        if (origin) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(origin).host === new URL(request.url).host;
          } catch {
            sameOrigin = false;
          }
          if (!sameOrigin) return json({ error: "forbidden" }, 403);
        }

        const { userId } = await auth();
        if (!userId) return json({ error: "unauthenticated" }, 401);

        const body = (await request.json().catch(() => null)) as {
          slug?: unknown;
          link?: unknown;
        } | null;
        const slug = typeof body?.slug === "string" ? body.slug : "";
        const token = typeof body?.link === "string" ? body.link : "";
        if (!slug || !/^[a-f0-9]{32}$/.test(token)) return json({ error: "invalid_link" }, 400);

        try {
          const service = serviceDb();
          const { data: link } = await service
            .from("application_links")
            .select("id, org_id, unit_id, active, organizations!inner(slug, status)")
            .eq("token", token)
            .maybeSingle();
          const org = link?.organizations as { slug: string; status: string } | undefined;
          if (!link || !link.active || org?.slug !== slug || org.status !== "active")
            return json({ error: "invalid_link" }, 404);

          const user = await clerkClient().users.getUser(userId);
          const verified = user.emailAddresses.filter(
            (address) => address.verification?.status === "verified",
          );
          const email = (
            verified.find((address) => address.id === user.primaryEmailAddressId) ?? verified[0]
          )?.emailAddress.toLowerCase();
          if (!email) return json({ error: "email_not_verified" }, 403);

          // The caller's own profile, else any profile already holding the email.
          let { data: profile } = await service
            .from("profiles")
            .select("id, role, org_id")
            .eq("clerk_user_id", userId)
            .maybeSingle();
          if (!profile) {
            const { data: taken } = await service
              .from("profiles")
              .select("id")
              .ilike("email", ilikeLiteral(email))
              .maybeSingle();
            if (taken) return json({ error: "account_exists" }, 409);
          }
          if (profile && profile.role !== "applicant")
            return json({ error: "account_exists" }, 409);
          if (profile && profile.org_id !== link.org_id)
            return json({ error: "other_company" }, 409);

          const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
          if (!profile) {
            const created = await service
              .from("profiles")
              .insert({
                clerk_user_id: userId,
                email,
                full_name: fullName,
                role: "applicant", // never from the request
                org_id: link.org_id,
              })
              .select("id, role, org_id")
              .single();
            if (created.error) throw created.error;
            profile = created.data;
            forgetProfile(userId);
          }

          const { data: existing } = await service
            .from("applications")
            .select("id")
            .eq("profile_id", profile.id)
            .eq("link_id", link.id)
            .maybeSingle();
          if (existing) return json({ application_id: existing.id });

          const { data: application, error } = await service
            .from("applications")
            .insert({
              org_id: link.org_id,
              unit_id: link.unit_id,
              link_id: link.id,
              profile_id: profile.id,
              full_name: fullName,
              email,
            })
            .select("id")
            .single();
          // applications_rate_limit: at most 5 new applications a day per login.
          if (error?.code === "54000") return json({ error: "rate_limited" }, 429);
          if (error) throw error;
          return json({ application_id: application.id });
        } catch (caught) {
          return fail(caught, "start-application");
        }
      },
    },
  },
});
