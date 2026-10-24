/**
 * Creates the demo logins in Clerk and links each one to its profile.
 *
 *   bun run db:demo-logins
 *
 * Reads CLERK_SECRET_KEY, POSTGREST_URL and POSTGREST_JWT_SECRET from
 * .env.local. POSTGREST_URL must reach PostgREST from this machine: the
 * local stack, or production through an SSH tunnel. Use a Clerk
 * DEVELOPMENT instance; never point this at production logins.
 * Idempotent: an existing login has its password reset and its profile
 * re-linked.
 */
import { clerkClient } from "@clerk/tanstack-react-start/server";
import { serviceDb } from "../src/lib/server/session";

const password = process.env["DEMO_PASSWORD"] ?? "Rentio2026!";

if (!process.env["CLERK_SECRET_KEY"] || !process.env["POSTGREST_JWT_SECRET"]) {
  console.error("Set CLERK_SECRET_KEY, POSTGREST_URL and POSTGREST_JWT_SECRET (see .env.example).");
  process.exit(1);
}

const clerk = clerkClient();
const admin = serviceDb();

interface DemoUser {
  email: string;
  fullName: string;
  role: "admin" | "manager" | "tenant";
  tenantId: string | null;
}

async function listAllUsers() {
  const all: { id: string; email?: string | undefined }[] = [];
  for (let offset = 0; offset < 4000; offset += 500) {
    const { data } = await clerk.users.getUserList({ limit: 500, offset });
    all.push(
      ...data.map((user) => ({ id: user.id, email: user.primaryEmailAddress?.emailAddress })),
    );
    if (data.length < 500) break;
  }
  return all;
}

/**
 * The three tenants seed.sql pins to fixed ids. Selecting by id is the whole
 * point: this used to take "the first three primary tenants by created_at",
 * but the seed inserts every tenant in one statement, so they share a
 * timestamp and the order between them was arbitrary. A different three
 * people got logins on each reseed and the demo credentials changed
 * underneath whoever was about to present.
 */
const DEMO_TENANT_IDS = [
  "00000000-0000-4000-8000-00000000d001",
  "00000000-0000-4000-8000-00000000d002",
  "00000000-0000-4000-8000-00000000d003",
];

async function main() {
  // The demo data is the first organization's.
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .order("created_at")
    .limit(1)
    .single();
  if (orgError) throw orgError;
  const orgId = org.id;

  const { data: pinned, error: tenantError } = await admin
    .from("tenants")
    .select("id, full_name, email")
    .in("id", DEMO_TENANT_IDS);
  if (tenantError) throw tenantError;

  // Fall back rather than silently handing out zero tenant logins, in case
  // someone reseeds from an older seed.sql that predates the pinned ids.
  let tenants = pinned ?? [];
  if (tenants.length === 0) {
    console.warn(
      "  no pinned demo tenants found — falling back to the first three primary tenants.\n" +
        "  Re-run supabase/seed.sql to get stable logins.",
    );
    const { data: links } = await admin
      .from("lease_tenants")
      .select("tenant_id")
      .eq("role", "primary")
      .limit(3);
    const { data: fallback } = await admin
      .from("tenants")
      .select("id, full_name, email")
      .in(
        "id",
        (links ?? []).map((row) => row.tenant_id),
      );
    tenants = fallback ?? [];
  }

  // Stable output order, so the printed credentials do not shuffle either.
  tenants = [...tenants].sort(
    (a, b) => DEMO_TENANT_IDS.indexOf(a.id) - DEMO_TENANT_IDS.indexOf(b.id),
  );

  const demo: DemoUser[] = [
    // The demo company is Sun City Property Management, so this is the
    // credential to show a customer.
    {
      email: "admin@suncitypm.com",
      fullName: "Mariana Torres Aguilar",
      role: "admin",
      tenantId: null,
    },
    {
      email: "manager@suncitypm.com",
      fullName: "Diego Lozano Ibarra",
      role: "manager",
      tenantId: null,
    },
    // Kept so saved passwords from before the El Paso rename still work.
    // It has to be listed here, not created by hand, or the prune below
    // removes it on the next run.
    {
      email: "admin@rentio.mx",
      fullName: "Mariana Torres Aguilar",
      role: "admin",
      tenantId: null,
    },
    ...(tenants ?? []).map((tenant) => ({
      email: tenant.email ?? `${tenant.id}@example.com`,
      fullName: tenant.full_name,
      role: "tenant" as const,
      tenantId: tenant.id,
    })),
  ];

  const existing = new Map(
    (await listAllUsers()).map((user) => [user.email?.toLowerCase(), user.id]),
  );

  for (const user of demo) {
    const found = existing.get(user.email.toLowerCase());
    let id = found;

    try {
      if (found) {
        await clerk.users.updateUser(found, { password, skipPasswordChecks: true });
      } else {
        const created = await clerk.users.createUser({
          emailAddress: [user.email],
          password,
          firstName: user.fullName,
          skipPasswordChecks: true,
        });
        id = created.id;
      }
    } catch (caught) {
      console.error(`  ${user.email.padEnd(30)} could not create or update: ${String(caught)}`);
      continue;
    }
    if (!id) continue;

    // Link directly instead of waiting for the first sign-in to do it.
    const fields = {
      full_name: user.fullName,
      role: user.role,
      tenant_id: user.tenantId,
      email: user.email.toLowerCase(),
      clerk_user_id: id,
      org_id: orgId,
      // locale stays NULL — "never chosen", so each portal's default applies:
      // English for staff, Spanish for tenants.
      locale: null,
    };
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .or(`email.eq."${user.email.toLowerCase()}",clerk_user_id.eq."${id}"`)
      .limit(1)
      .maybeSingle();
    const { error: profileError } = profile
      ? await admin.from("profiles").update(fields).eq("id", profile.id)
      : await admin.from("profiles").insert(fields);
    console.log(
      `  ${user.email.padEnd(30)} ${user.role.padEnd(8)} ${profileError ? `profile failed: ${profileError.message}` : "ok"}`,
    );
  }

  // Prune logins this run did not claim.
  //
  // Reseeding changes which tenants exist, and their emails with them. The
  // seed's TRUNCATE cascades away the profile rows but cannot touch
  // Clerk, so every earlier demo account survives as a login with no
  // profile — it signs in fine and then lands in the app with no role.
  // Whoever is demoing hits a blank portal and has no idea why.
  const wanted = new Set(demo.map((user) => user.email.toLowerCase()));
  const stale = (await listAllUsers()).filter((user) => {
    const email = user.email?.toLowerCase();
    if (!email || wanted.has(email)) return false;
    // Only ever touch demo domains. A real invited user is not ours to delete.
    return /@(example\.com|example\.mx|suncitypm\.com|rentio\.mx)$/.test(email);
  });

  for (const user of stale) {
    const outcome = await clerk.users.deleteUser(user.id).then(
      () => "removed",
      (caught: unknown) => `could not remove: ${String(caught)}`,
    );
    console.log(`  ${(user.email ?? user.id).padEnd(30)} ${"stale".padEnd(8)} ${outcome}`);
  }

  // Reseeding changes which tenants exist, so the tenant logins change with
  // them. Print them where whoever is about to demo will actually see them,
  // rather than leaving them to be guessed from the seed.
  console.log(`\n  Demo credentials — password for all of them: ${password}\n`);
  for (const role of ["admin", "manager", "tenant"] as const) {
    for (const user of demo.filter((candidate) => candidate.role === role)) {
      console.log(`    ${role.padEnd(8)} ${user.email}`);
    }
  }
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
