import { createFileRoute } from "@tanstack/react-router";
import { toCsv } from "@/lib/csv";
import { todayIso } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import { fail, requireSession, type Db } from "@/lib/server/session";
import { zipStore } from "@/lib/server/zip";

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Table = keyof Database["public"]["Tables"];

/** Everything a company would need to leave us, one CSV per table. */
const TABLES: Table[] = [
  "properties",
  "units",
  "parking_spaces",
  "tenants",
  "leases",
  "lease_tenants",
  "lease_notices",
  "invoices",
  "invoice_lines",
  "payments",
  "payment_allocations",
  "work_orders",
  "work_order_notes",
  "expenses",
];

const PAGE = 1000;

/** Every row the caller may read. PostgREST caps a response, so page through. */
async function readAll(db: Db, table: Table) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) return rows;
  }
}

function csvFor(rows: Record<string, unknown>[]) {
  const headers = Object.keys(rows[0] ?? {});
  const cell = (value: unknown) =>
    value === null || value === undefined
      ? null
      : typeof value === "object"
        ? JSON.stringify(value)
        : (value as string | number);
  // BOM so Excel opens accented names correctly, as downloadCsv does.
  return (
    "﻿" +
    toCsv(
      headers,
      rows.map((row) => headers.map((key) => cell(row[key]))),
    )
  );
}

/**
 * Admin only. A ZIP of CSVs of the caller's company. Read through the
 * caller's own client, so RLS and org isolation decide what is in it; the
 * platform view (no company picked) is refused.
 */
export const Route = createFileRoute("/api/fn/export-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await requireSession(request);
        if (session instanceof Response) return session;
        if (!session.isAdmin || !session.profile.org_id) return json({ error: "forbidden" }, 403);

        try {
          const files = [];
          for (const table of TABLES) {
            files.push({ name: `${table}.csv`, data: csvFor(await readAll(session.db, table)) });
          }
          await session.db.from("activity_log").insert({
            actor_id: session.profile.id,
            entity_type: "organization",
            entity_id: session.profile.org_id,
            action: "export_all",
            meta: { tables: TABLES.length },
          });
          return new Response(zipStore(files), {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="rentio-export-${todayIso()}.zip"`,
              "Cache-Control": "no-store",
            },
          });
        } catch (caught) {
          return fail(caught, "export-all");
        }
      },
    },
  },
});
