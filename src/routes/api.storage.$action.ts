import { createFileRoute } from "@tanstack/react-router";
import { fail, requireSession } from "@/lib/server/session";
import { isBucket, mayAccess, putObject, removeObject, signedUrl } from "@/lib/server/storage";

const MAX_BYTES = 15 * 1024 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * What the browser did through supabase.storage, now on the app server:
 *   upload  multipart { bucket, path, file }          → { path }
 *   sign    { bucket, paths[], expiresIn? }          → { urls: { [path]: url } }
 *   remove  { bucket, path }                          → { removed: true }
 */
export const Route = createFileRoute("/api/storage/$action")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        const orgId = session.profile.org_id;
        if (!orgId) return json({ error: "no organization" }, 403);

        try {
          if (params.action === "upload") {
            const form = await request.formData();
            const bucket = form.get("bucket");
            const path = form.get("path");
            const file = form.get("file");
            if (!isBucket(bucket) || typeof path !== "string" || !(file instanceof File)) {
              return json({ error: "bucket, path and file are required" }, 400);
            }
            if (file.size > MAX_BYTES) return json({ error: "file too large" }, 413);
            if (!(await mayAccess(session, bucket, path, "write")))
              return json({ error: "forbidden" }, 403);
            await putObject(orgId, bucket, path, new Uint8Array(await file.arrayBuffer()));
            return json({ path });
          }

          const body = (await request.json()) as {
            bucket?: unknown;
            paths?: unknown;
            path?: unknown;
            expiresIn?: unknown;
          };
          if (!isBucket(body.bucket)) return json({ error: "unknown bucket" }, 400);
          const bucket = body.bucket;

          if (params.action === "sign") {
            const paths = Array.isArray(body.paths)
              ? body.paths.filter((p): p is string => typeof p === "string")
              : [];
            const expiresIn =
              typeof body.expiresIn === "number" ? Math.min(body.expiresIn, 3600) : 600;
            const urls: Record<string, string> = {};
            // A path the caller may not read, or a malformed one, is simply
            // absent, like a missing file.
            for (const path of new Set(paths)) {
              try {
                if (await mayAccess(session, bucket, path, "read"))
                  urls[path] = signedUrl(orgId, bucket, path, expiresIn);
              } catch {
                /* absent */
              }
            }
            return json({ urls });
          }

          if (params.action === "remove") {
            if (!session.isStaff) return json({ error: "forbidden" }, 403);
            if (typeof body.path !== "string") return json({ error: "path is required" }, 400);
            await removeObject(orgId, bucket, body.path);
            return json({ removed: true });
          }

          return json({ error: "not found" }, 404);
        } catch (caught) {
          return fail(caught, `storage ${params.action}`);
        }
      },
    },
  },
});
