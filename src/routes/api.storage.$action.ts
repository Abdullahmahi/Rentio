import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { fail, requireSession, serviceDb } from "@/lib/server/session";
import {
  isBucket,
  isSealed,
  mayAccess,
  putObject,
  removeObject,
  signedUrl,
  sniffUpload,
} from "@/lib/server/storage";

const MAX_BYTES = 15 * 1024 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * An application upload. The server names it (<application_id>/<uuid>.<ext>,
 * from the sniffed type, never the client's name) and files the row with
 * the service connection; the row's trigger enforces 10 files / 50 MB per
 * application. The caller already passed mayAccess for this application.
 */
async function uploadApplicationFile(
  orgId: string,
  applicationId: string,
  kind: "id" | "pay_stub" | "other",
  fileName: string,
  bytes: Uint8Array,
) {
  const sniffed = sniffUpload(bytes);
  if (!sniffed) return json({ error: "only PDF, JPEG, PNG or HEIC files" }, 415);
  const path = `${applicationId}/${randomUUID()}.${sniffed.ext}`;
  const service = serviceDb();
  const { data: application } = await service
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!application) return json({ error: "not found" }, 404);
  const { error } = await service.from("application_files").insert({
    org_id: orgId,
    application_id: applicationId,
    kind,
    path,
    file_name: fileName.slice(0, 200),
    size_bytes: bytes.length,
    content_type: sniffed.type,
  });
  if (error?.code === "54000") return json({ error: error.message }, 413);
  if (error) throw error;
  try {
    await putObject(orgId, "applications", path, bytes, { exclusive: true });
  } catch (caught) {
    await service.from("application_files").delete().eq("path", path).eq("org_id", orgId);
    throw caught;
  }
  return json({ path });
}

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
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (bucket === "applications") {
              const kind = form.get("kind");
              return await uploadApplicationFile(
                orgId,
                path.split("/")[0]!,
                kind === "id" || kind === "pay_stub" ? kind : "other",
                file.name,
                bytes,
              );
            }
            await putObject(orgId, bucket, path, bytes);
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
            if (isSealed(body.path)) return json({ error: "forbidden" }, 403);
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
