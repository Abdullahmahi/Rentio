/**
 * Creates the demo logins through the Supabase Admin API.
 *
 * Why not SQL: hand-inserting into `auth.users` produces rows GoTrue cannot
 * scan ("Database error querying schema" on every sign-in, and the Admin API
 * cannot even delete them because it loads the user first). GoTrue owns that
 * table's shape across versions — let it write the rows.
 *
 *   bun run db:demo-logins
 *
 * Reads VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Idempotent: an existing account has its password and profile reset.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env["VITE_SUPABASE_URL"];
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const password = process.env["DEMO_PASSWORD"] ?? "Rentio2026!";

if (!url || !serviceKey) {
  console.error("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

interface DemoUser {
  email: string;
  fullName: string;
  role: "admin" | "manager" | "tenant";
  tenantId: string | null;
}

async function listAllUsers() {
  const all: { id: string; email?: string | undefined }[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    all.push(...data.users);
    if (data.users.length < 200) break;
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

    if (found) {
      const { error } = await admin.auth.admin.updateUserById(found, {
        password,
        email_confirm: true,
      });
      if (error) {
        console.error(`  ${user.email.padEnd(30)} could not update: ${error.message}`);
        console.error("     A row GoTrue cannot load must be removed in SQL first — see SETUP.md.");
        continue;
      }
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: user.fullName },
      });
      if (error) {
        console.error(`  ${user.email.padEnd(30)} could not create: ${error.message}`);
        continue;
      }
      id = data.user.id;
    }

    if (!id) continue;
    const { error: profileError } = await admin.from("profiles").upsert({
      id,
      full_name: user.fullName,
      role: user.role,
      tenant_id: user.tenantId,
      // locale stays NULL — "never chosen", so each portal's default applies:
      // English for staff, Spanish for tenants. Forcing it here put every
      // staff account into Spanish regardless.
      locale: null,
    });
    if (profileError) {
      console.error(`  ${user.email.padEnd(30)} profile failed: ${profileError.message}`);
      continue;
    }

    // Prove it: a row that exists is not the same as a login that works.
    const probe = createClient(url!, process.env["VITE_SUPABASE_ANON_KEY"] ?? "", {
      auth: { persistSession: false },
    });
    const { error: signInError } = await probe.auth.signInWithPassword({
      email: user.email,
      password,
    });
    console.log(
      `  ${user.email.padEnd(30)} ${user.role.padEnd(8)} ${signInError ? `SIGN-IN FAILED: ${signInError.message}` : "sign-in OK"}`,
    );
  }

  // Prune logins this run did not claim.
  //
  // Reseeding changes which tenants exist, and their emails with them. The
  // seed's TRUNCATE cascades away the profile rows but cannot touch
  // auth.users, so every earlier demo account survives as a login with no
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
    const { error } = await admin.auth.admin.deleteUser(user.id);
    console.log(
      `  ${(user.email ?? user.id).padEnd(30)} ${"stale".padEnd(8)} ${error ? `could not remove: ${error.message}` : "removed"}`,
    );
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
