import { createFileRoute } from "@tanstack/react-router";
import { CONSENT_VERSION } from "@/lib/esign";
import { clientIp, companyName, finaliseIfComplete, hashToken } from "@/lib/server/esign";
import { serviceDb } from "@/lib/server/session";
import { signedUrl } from "@/lib/server/storage";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * The signer's side, for someone with no login (an applicant, or a tenant
 * who never set up the portal). The token in the link is the only
 * credential: it is hashed and looked up with the service connection, and
 * every later query is filtered by the org of the signer row it found. The
 * caller sees their own agreement and nothing else: no tokens, no other
 * signer's email, IP or signature.
 *
 *   GET   → the agreement to read (marks it opened)
 *   POST  { kind: "drawn"|"typed", data, consent: true, locale } → signs
 */
async function resolve(token: string) {
  const hash = hashToken(token);
  if (!hash) return null;
  const service = serviceDb();
  const { data: signer } = await service
    .from("signature_signers")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!signer) return null;
  const { data: request } = await service
    .from("signature_requests")
    .select("*")
    .eq("id", signer.request_id)
    .eq("org_id", signer.org_id)
    .single();
  if (!request) return null;
  return { signer, request, orgId: signer.org_id };
}

type Resolved = NonNullable<Awaited<ReturnType<typeof resolve>>>;

function stateOf({ signer, request }: Resolved) {
  if (request.status === "voided") return "voided";
  if (request.status === "completed") return "completed";
  if (signer.signed_at) return "signed";
  const now = Date.now();
  if (new Date(signer.token_expires_at).getTime() < now) return "expired";
  if (new Date(request.expires_at).getTime() < now) return "expired";
  return "open";
}

async function describe(found: Resolved) {
  const { signer, request, orgId } = found;
  const service = serviceDb();
  const state = stateOf(found);
  const [{ data: others }, { data: lease }, company] = await Promise.all([
    service
      .from("signature_signers")
      .select("id, name, signed_at")
      .eq("request_id", request.id)
      .eq("org_id", orgId)
      .order("position"),
    service
      .from("leases")
      .select("unit_id")
      .eq("id", request.lease_id)
      .eq("org_id", orgId)
      .maybeSingle(),
    companyName(orgId),
  ]);
  const { data: unit } = lease
    ? await service
        .from("units")
        .select("unit_number")
        .eq("id", lease.unit_id)
        .eq("org_id", orgId)
        .maybeSingle()
    : { data: null };
  const readable = state === "open" || state === "signed" || state === "completed";
  return {
    state,
    company,
    title: request.title,
    unit: unit?.unit_number ?? null,
    page_count: request.page_count,
    signer: {
      name: signer.name,
      email: signer.email,
      locale: signer.locale,
      page: signer.page,
      box: { x: signer.x, y: signer.y, w: signer.w, h: signer.h },
      signed_at: signer.signed_at,
    },
    others: (others ?? [])
      .filter((row) => row.id !== signer.id)
      .map((row) => ({ name: row.name, signed: Boolean(row.signed_at) })),
    pdf_url: readable ? signedUrl(orgId, "contracts", request.original_path, 3600) : null,
    signed_pdf_url:
      state === "completed" && request.signed_path
        ? signedUrl(orgId, "contracts", request.signed_path, 3600)
        : null,
  };
}

/** A real PNG, not just something claiming to be one: the finaliser embeds it. */
function isPngDataUrl(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match || value.length > 300_000) return false;
  const bytes = Buffer.from(match[1]!, "base64");
  return (
    bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  );
}

/** Retry path for a finaliser that crashed: any later visit tries again. */
async function finaliseQuietly(requestId: string, orgId: string) {
  try {
    await finaliseIfComplete(requestId, orgId);
  } catch (caught) {
    console.error("esign finalise", caught);
  }
}

export const Route = createFileRoute("/api/sign/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const found = await resolve(params.token);
        if (!found) return json({ state: "invalid" }, 404);
        const { signer, request, orgId } = found;
        const state = stateOf(found);
        if (state === "open" && !signer.viewed_at) {
          const viewedAt = new Date().toISOString();
          await serviceDb()
            .from("signature_signers")
            .update({ viewed_at: viewedAt })
            .eq("id", signer.id)
            .eq("org_id", orgId)
            .is("viewed_at", null);
          signer.viewed_at = viewedAt;
        }
        if (request.status === "sent" && signer.signed_at) {
          await finaliseQuietly(request.id, orgId);
          return json(await describe((await resolve(params.token)) ?? found));
        }
        return json(await describe(found));
      },

      POST: async ({ request: http, params }) => {
        // No session to lean on, so refuse cross-site posts here.
        const origin = http.headers.get("origin");
        if (origin) {
          let same = false;
          try {
            same = new URL(origin).host === new URL(http.url).host;
          } catch {
            same = false;
          }
          if (!same) return json({ error: "forbidden" }, 403);
        }

        const found = await resolve(params.token);
        if (!found) return json({ state: "invalid" }, 404);
        if (stateOf(found) !== "open")
          return json({ error: "closed", ...(await describe(found)) }, 409);
        const { signer, request, orgId } = found;

        const body = (await http.json().catch(() => ({}))) as {
          kind?: unknown;
          data?: unknown;
          consent?: unknown;
          locale?: unknown;
        };
        const locale = body.locale === "en" ? "en" : "es-MX";
        if (body.consent !== true) return json({ error: "consent is required" }, 400);
        let data: string;
        if (body.kind === "drawn" && typeof body.data === "string" && isPngDataUrl(body.data)) {
          data = body.data;
        } else if (body.kind === "typed" && typeof body.data === "string") {
          data = body.data
            .replace(/[\p{Cc}]/gu, "")
            .trim()
            .slice(0, 80);
          if (!data) return json({ error: "type your name" }, 400);
        } else {
          return json({ error: "a signature is required" }, 400);
        }

        const now = new Date().toISOString();
        const { data: signed, error } = await serviceDb()
          .from("signature_signers")
          .update({
            signed_at: now,
            viewed_at: signer.viewed_at ?? now,
            signature_kind: body.kind as string,
            signature_data: data,
            consent_at: now,
            consent_version: `${CONSENT_VERSION}:${locale}`,
            ip: clientIp(http),
            user_agent: http.headers.get("user-agent")?.slice(0, 500) ?? null,
          })
          .eq("id", signer.id)
          .eq("org_id", orgId)
          .is("signed_at", null)
          .select("id");
        if (error) return json({ error: "could not save the signature" }, 500);
        if (!signed.length) return json({ error: "already signed" }, 409);

        await finaliseQuietly(request.id, orgId);
        return json(await describe((await resolve(params.token)) ?? found));
      },
    },
  },
});
