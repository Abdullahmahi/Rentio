import { createFileRoute } from "@tanstack/react-router";
import { POSTGREST_URL, forgetProfile, requireSession } from "@/lib/server/session";

// What supabase-js / postgrest-js send and read. Nothing else crosses.
const REQUEST_HEADERS = ["accept", "content-type", "prefer", "range", "range-unit"];
const RESPONSE_HEADERS = ["content-type", "content-range", "preference-applied", "location"];

/**
 * The data API: the browser's `db.from(...)` calls land here and go on to
 * PostgREST (private, on the Docker network) as the signed-in user. Same
 * origin as the app, so no CORS and no second public hostname.
 */
export const Route = createFileRoute("/rest/v1/$")({
  server: {
    handlers: {
      ANY: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;

        const headers = new Headers({ Authorization: `Bearer ${session.token}` });
        for (const name of REQUEST_HEADERS) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const hasBody = request.method !== "GET" && request.method !== "HEAD";
        const upstream = await fetch(
          `${POSTGREST_URL}/${params._splat ?? ""}${new URL(request.url).search}`,
          {
            method: request.method,
            headers,
            ...(hasBody ? { body: await request.arrayBuffer() } : {}),
          },
        );

        // A profile edit (locale, name) must show up on the next /api/me, not
        // in a minute.
        if (upstream.ok && request.method === "PATCH" && params._splat?.startsWith("profiles")) {
          forgetProfile(session.profile.clerk_user_id);
        }

        const out = new Headers();
        for (const name of RESPONSE_HEADERS) {
          const value = upstream.headers.get(name);
          if (value) out.set(name, value);
        }
        return new Response(upstream.body, { status: upstream.status, headers: out });
      },
    },
  },
});
