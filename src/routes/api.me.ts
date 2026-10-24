import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/server/session";

/** The signed-in user's profile, linking it to the Clerk login on first
 *  sign-in. 403 `no_profile` means a valid login nobody has given access. */
export const Route = createFileRoute("/api/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        return Response.json({ profile: session.profile });
      },
    },
  },
});
