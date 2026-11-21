import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { LINK_DAYS, parseSigners, signLink } from "@/lib/esign";
import { siteUrl } from "@/lib/server/email";
import {
  companyName,
  emailSigningLink,
  inspectPdf,
  newToken,
  originalPath,
  sha256Hex,
} from "@/lib/server/esign";
import { fail, requireSession } from "@/lib/server/session";
import { getObject, putObject, removeObject } from "@/lib/server/storage";

const json = (body: unknown, status = 200) => Response.json(body, { status });

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
          if (!leaseId || !title) return json({ error: "lease_id and title are required" }, 400);

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

          const parsed = parseSigners(body.signers, pages, onLease);
          if ("error" in parsed) return json({ error: parsed.error }, 400);
          const { signers } = parsed;

          // A tenant's own portal language; Spanish when they never chose (the portal default).
          const tenantIds = signers.flatMap((signer) => (signer.tenantId ? [signer.tenantId] : []));
          const { data: profiles } = tenantIds.length
            ? await db.from("profiles").select("tenant_id, locale").in("tenant_id", tenantIds)
            : { data: [] };
          const localeOf = (tenantId: string | null) =>
            profiles?.find((row) => row.tenant_id === tenantId)?.locale === "en" ? "en" : "es-MX";

          const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
          const requestId = randomUUID();
          // The request's own copy, written once (never overwritten) at a
          // path staff uploads refuse; its hash is checked before every use.
          await putObject(orgId, "contracts", originalPath(leaseId, requestId), bytes, {
            exclusive: true,
          });

          const rows = signers.map((signer) => ({
            id: randomUUID(),
            name: signer.name,
            email: signer.email,
            tenant_id: signer.tenantId,
            locale: localeOf(signer.tenantId),
            position: signer.position,
            required: signer.required,
            page: signer.page,
            ...signer.box,
            ...newToken(),
          }));
          // One staff-only function files the request and its signers; staff
          // have no direct write on either table.
          const { error: sendError } = await db.rpc("send_signature_request", {
            p_id: requestId,
            p_lease: leaseId,
            p_title: title,
            p_message: message,
            p_sha: sha256Hex(bytes),
            p_page_count: pages.length,
            p_expires_at: expiresAt,
            p_signers: rows.map(({ token: _token, hash, ...row }) => ({
              ...row,
              token_hash: hash,
            })),
          });
          if (sendError) {
            await removeObject(orgId, "contracts", originalPath(leaseId, requestId));
            throw sendError;
          }
          const created = { id: requestId };

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
            if (emailed) await db.rpc("mark_signature_emailed", { p_signer: row.id });
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
