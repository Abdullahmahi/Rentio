import { createFileRoute } from "@tanstack/react-router";
import { contentTypeFor, getObject, isBucket, verifySignedUrl } from "@/lib/server/storage";

/** Serves a file behind a signed URL from /api/storage/sign. The signature
 *  is the authorization: it was only minted after the access check. */
export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const target = params._splat ?? "";
        const url = new URL(request.url);
        if (!verifySignedUrl(target, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
          return new Response("link expired or invalid", { status: 403 });
        }
        const [orgId = "", bucket, ...rest] = target.split("/");
        const objectPath = rest.join("/");
        if (!isBucket(bucket)) return new Response("not found", { status: 404 });

        const bytes = await getObject(orgId, bucket, objectPath).catch(() => null);
        if (!bytes) return new Response("not found", { status: 404 });
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": contentTypeFor(objectPath),
            "content-disposition": "inline",
            "x-content-type-options": "nosniff",
            "cache-control": "private, max-age=300",
          },
        });
      },
    },
  },
});
