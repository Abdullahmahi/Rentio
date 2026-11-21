import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { boxInside, isEmail, LINK_DAYS, signLink } from "@/lib/esign";
import { siteUrl } from "@/lib/server/email";
import { companyName, emailSigningLink, inspectPdf, newToken, sha256Hex } from "@/lib/server/esign";
import { fail, requireSession } from "@/lib/server/session";
import { getObject } from "@/lib/server/storage";

const json = (body: unknown, status = 200) => Response.json(body, { status });

interface SignerInput {
  name?: unknown;
  email?: unknown;
  tenant_id?: unknown;
  page?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * S1. Staff send a lease PDF (already in the contracts bucket under the
 * lease) for signature. Everything is written through the caller's client,
 * so RLS keeps it in their org. Each signer gets a fresh link; when email
 * is not configured the links come back for staff to copy.
 */
export const Route = createFileRoute("/api/fn/esign-send")({
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
            lease_id?: unknown;
            path?: unknown;
            title?: unknown;
            message?: unknown;
            signers?: unknown;
          };
          const leaseId = text(body.lease_id, 40);
          const path = text(body.path, 300);
          const title = text(body.title, 200);
          const message = text(body.message, 2000) || null;
          const inputs = Array.isArray(body.signers) ? (body.signers as SignerInput[]) : [];
          if (!leaseId || !title) return json({ error: "lease_id and title are required" }, 400);
          if (inputs.length < 1 || inputs.length > 10)
            return json({ error: "between 1 and 10 signers" }, 400);

          const { data: lease } = await db
            .from("leases")
            .select("id")
            .eq("id", leaseId)
            .maybeSingle();
          if (!lease) return json({ error: "not found" }, 404);
          // Only a PDF filed under this lease, so a path cannot point elsewhere.
          if (!path.startsWith(`${leaseId}/`) || !path.toLowerCase().endsWith(".pdf"))
            return json({ error: "choose a PDF filed on this lease" }, 400);

          const bytes = await getObject(orgId, "contracts", path);
          if (!bytes) return json({ error: "file not found" }, 404);
          let pages: Awaited<ReturnType<typeof inspectPdf>>;
          try {
            pages = await inspectPdf(new Uint8Array(bytes));
          } catch {
            return json({ error: "That file is not a readable PDF" }, 400);
          }

          const { data: parties } = await db
            .from("lease_tenants")
            .select("tenant_id")
            .eq("lease_id", leaseId);
          const onLease = new Set((parties ?? []).map((row) => row.tenant_id));

          const signers = [];
          for (const [position, input] of inputs.entries()) {
            const name = text(input.name, 120);
            const email = text(input.email, 160).toLowerCase();
            const tenantId = typeof input.tenant_id === "string" ? input.tenant_id : null;
            const box = {
              x: Number(input.x),
              y: Number(input.y),
              w: Number(input.w),
              h: Number(input.h),
            };
            const page = Number(input.page);
            const bounds = pages[page - 1];
            if (!name || !isEmail(email))
              return json({ error: "every signer needs a name and an email" }, 400);
            if (tenantId && !onLease.has(tenantId))
              return json({ error: "that tenant is not on this lease" }, 400);
            if (!Number.isInteger(page) || !bounds || !boxInside(box, bounds))
              return json({ error: `place ${name}'s signature on the page` }, 400);
            signers.push({ name, email, tenantId, page, box, position });
          }

          // A tenant's own portal language; Spanish when they never chose (the portal default).
          const tenantIds = signers.flatMap((signer) => (signer.tenantId ? [signer.tenantId] : []));
          const { data: profiles } = tenantIds.length
            ? await db.from("profiles").select("tenant_id, locale").in("tenant_id", tenantIds)
            : { data: [] };
          const localeOf = (tenantId: string | null) =>
            profiles?.find((row) => row.tenant_id === tenantId)?.locale === "en" ? "en" : "es-MX";

          const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
          const { data: created, error: requestError } = await db
            .from("signature_requests")
            .insert({
              lease_id: leaseId,
              title,
              message,
              original_path: path,
              original_sha256: sha256Hex(bytes),
              page_count: pages.length,
              created_by: session.profile.id,
              expires_at: expiresAt,
            })
            .select("id")
            .single();
          if (requestError) throw requestError;

          // Ids minted here and no RETURNING: token_hash is outside the
          // caller's column grant, so nothing reads the rows back.
          const rows = signers.map((signer) => ({
            id: randomUUID(),
            request_id: created.id,
            name: signer.name,
            email: signer.email,
            tenant_id: signer.tenantId,
            locale: localeOf(signer.tenantId),
            position: signer.position,
            page: signer.page,
            ...signer.box,
            ...newToken(),
            token_expires_at: expiresAt,
          }));
          const { error: signersError } = await db
            .from("signature_signers")
            .insert(rows.map(({ token: _token, hash, ...row }) => ({ ...row, token_hash: hash })));
          if (signersError) throw signersError;

          const company = await companyName(orgId);
          const result = [];
          for (const row of rows) {
            const token = row.token;
            const emailed = await emailSigningLink({
              to: row.email,
              name: row.name,
              locale: row.locale,
              company,
              title,
              token,
              expiresAt,
              message,
            });
            if (emailed)
              await db
                .from("signature_signers")
                .update({ emailed_at: new Date().toISOString() })
                .eq("id", row.id);
            result.push({
              id: row.id,
              name: row.name,
              email: row.email,
              emailed,
              link: signLink(siteUrl(), token),
            });
          }

          await db.from("activity_log").insert({
            actor_id: session.profile.id,
            entity_type: "lease",
            entity_id: leaseId,
            action: "esign_send",
            meta: { request_id: created.id, signers: rows.length },
          });
          return json({ request_id: created.id, signers: result });
        } catch (caught) {
          return fail(caught, "esign-send");
        }
      },
    },
  },
});
