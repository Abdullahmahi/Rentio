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

async function main() {
  // The three tenants with portal access are the first primary tenants in the
  // seed, so the demo always matches whatever seed.sql actually created.
  const { data: links, error: linkError } = await admin
    .from("lease_tenants")
    .select("tenant_id, created_at")
    .eq("role", "primary")
    .order("created_at")
    .limit(3);
  if (linkError) throw linkError;

  const { data: tenants, error: tenantError } = await admin
    .from("tenants")
    .select("id, full_name, email")
    .in(
      "id",
      (links ?? []).map((row) => row.tenant_id),
    );
  if (tenantError) throw tenantError;

  const demo: DemoUser[] = [
    { email: "admin@rentio.mx", fullName: "Mariana Torres Aguilar", role: "admin", tenantId: null },
    {
      email: "gerente@rentio.mx",
      fullName: "Diego Lozano Ibarra",
      role: "manager",
      tenantId: null,
    },
    ...(tenants ?? []).map((tenant) => ({
      email: tenant.email ?? `${tenant.id}@example.mx`,
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
      locale: "es-MX",
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
