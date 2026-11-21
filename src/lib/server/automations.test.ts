/**
 * Company isolation for the automation pipeline (issues #13, #14), with the
 * database mocked. The server runs this as service_role, so RLS is off: the
 * only thing keeping company B safe is that every call is filtered to the
 * company being run. The fake database records every call and, like a
 * buggy RPC would, offers company B's rows back; nothing of B may be
 * written or emailed. The SQL side is covered in supabase/tests/rls_test.sql.
 */
import { beforeEach, expect, mock, test } from "bun:test";

const A = "org-a";
const B = "org-b";

const sent: string[] = [];
const invoiceEmails: string[] = [];
mock.module("@/lib/server/email", () => ({
  sendEmail: async ({ to }: { to: string }) => void sent.push(to),
  siteUrl: () => "https://rentio.test",
}));
mock.module("@/lib/server/send-invoice-email", () => ({
  sendInvoiceEmail: async (_db: unknown, orgId: string, id: string) =>
    void invoiceEmails.push(`${orgId}:${id}`),
}));
mock.module("@/lib/server/late-fee-email", () => ({
  lateFeeWarningEmail: () => ({ subject: "s", html: "h" }),
}));
mock.module("@/lib/server/notification-email", () => ({
  notificationEmail: () => ({ subject: "s", html: "h" }),
}));
mock.module("@/lib/server/session", () => ({
  clientFor: () => ({ scoped: true }),
  signJwt: () => "token",
}));

const { runAutomations, runAllAutomations } = await import("@/lib/server/automations");
const { drainNotifications } = await import("@/lib/server/notifications");

interface Call {
  kind: "rpc" | "from";
  name: string;
  args?: Record<string, unknown>;
  ops: [string, ...unknown[]][];
}
let calls: Call[] = [];

/** RPC answers: rows of BOTH companies, as if the SQL filter were broken. */
function rpcData(name: string, args: Record<string, unknown>) {
  const org = args["p_org_id"];
  switch (name) {
    case "nightly":
      return {
        today: "2026-11-21",
        orgs: [
          { org_id: org, invoices_created: 1, invoice_ids: [`${org}-inv`] },
          { org_id: B, invoices_created: 9, invoice_ids: ["b-inv"] },
        ],
      };
    case "late_fee_warnings_to_send":
      return [
        { invoice_id: "a-w", org_id: org, tenant_email: `${org}@tenant` },
        { invoice_id: "b-w", org_id: B, tenant_email: "b@tenant" },
      ];
    case "queue_rent_reminders":
      return 2;
    case "claim_notifications":
      return [
        { id: "a-n", org_id: org, kind: "rent_reminder", tenant_email: `${org}@notify` },
        { id: "b-n", org_id: B, kind: "rent_reminder", tenant_email: "b@notify" },
      ];
    default:
      return null;
  }
}

function tableData(call: Call) {
  if (call.name === "organizations") return [{ id: A }, { id: B }];
  if (call.name === "settings") return { auto_invoice_send: true };
  if (call.name === "profiles") return { id: "admin-a" };
  if (call.name === "late_fee_warnings") return [{ invoice_id: "x" }];
  return null;
}

function fakeDb() {
  const builder = (call: Call) => {
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "update", "insert", "eq", "is", "in", "limit", "maybeSingle"])
      chain[op] = (...args: unknown[]) => {
        call.ops.push([op, ...args]);
        return chain;
      };
    chain["then"] = (resolve: (value: unknown) => void) =>
      resolve({ data: tableData(call), error: null });
    return chain;
  };
  return {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ kind: "rpc", name, args, ops: [] });
      return { data: rpcData(name, args), error: null };
    },
    from: (name: string) => {
      const call: Call = { kind: "from", name, ops: [] };
      calls.push(call);
      return builder(call);
    },
  };
}

beforeEach(() => {
  calls = [];
  sent.length = 0;
  invoiceEmails.length = 0;
});

/** Every call must be pinned to `org`: an RPC by p_org_id, a write by
 *  eq("org_id", org) or an inserted org_id. */
function expectOnlyTouches(org: string) {
  for (const call of calls) {
    if (call.kind === "rpc") {
      if (call.name === "notification_result") {
        expect(String(call.args?.["p_id"])).not.toStartWith("b-");
        continue;
      }
      expect(call.args?.["p_org_id"]).toBe(org);
      continue;
    }
    if (call.name === "organizations") continue; // the cron's list of companies
    const insert = call.ops.find(([op]) => op === "insert");
    if (insert) {
      expect((insert[1] as { org_id: string }).org_id).toBe(org);
      continue;
    }
    const scoped = call.ops.some(
      ([op, col, val]) => op === "eq" && col === "org_id" && val === org,
    );
    expect(scoped).toBe(true);
    // nothing addressed by one of B's ids
    for (const [, , val] of call.ops) expect(String(val)).not.toStartWith("b-");
  }
}

test("Run now for company A only ever touches and emails company A", async () => {
  const result = await runAutomations(fakeDb() as never, A, "manual", "admin-a");
  expectOnlyTouches(A);
  expect(sent.sort()).toEqual([`${A}@notify`, `${A}@tenant`]);
  expect(invoiceEmails).toEqual([`${A}:${A}-inv`]);
  expect(result.invoices_created).toBe(1);
  expect(result.errors).toEqual([]);
  const logs = calls.filter((c) => c.name === "job_runs");
  expect(logs).toHaveLength(1);
});

test("Send notifications drains only the caller's company", async () => {
  const drained = await drainNotifications(fakeDb() as never, A);
  expectOnlyTouches(A);
  expect(sent).toEqual([`${A}@notify`]);
  expect(drained.emailed).toBe(1);
});

test("the nightly cron runs every company separately, one log row each", async () => {
  const summary = await runAllAutomations(fakeDb() as never);
  expect(Object.keys(summary.per_org).sort()).toEqual([A, B]);
  const nightlyOrgs = calls.filter((c) => c.name === "nightly").map((c) => c.args?.["p_org_id"]);
  expect(nightlyOrgs).toEqual([A, B]);
  const logOrgs = calls
    .filter((c) => c.name === "job_runs")
    .map((c) => (c.ops.find(([op]) => op === "insert")![1] as { org_id: string }).org_id);
  expect(logOrgs).toEqual([A, B]);
});

test("one company failing does not stop the next", async () => {
  const db = fakeDb();
  const rpc = db.rpc;
  db.rpc = async (name, args = {}) => {
    if (name === "nightly" && args["p_org_id"] === A) throw new Error("boom");
    return rpc(name, args);
  };
  const summary = await runAllAutomations(db as never);
  expect(summary.per_org[A]!.errors).toEqual(["boom"]);
  expect(summary.per_org[B]!.errors).toEqual([]);
  expect(summary.orgs_with_errors).toEqual([A]);
  expect(calls.filter((c) => c.name === "job_runs")).toHaveLength(2);
});

test("refuses to run without a company", async () => {
  expect(runAutomations(fakeDb() as never, "", "manual")).rejects.toThrow();
  expect(drainNotifications(fakeDb() as never, "")).rejects.toThrow();
});
