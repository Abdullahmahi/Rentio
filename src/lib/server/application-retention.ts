/**
 * Server-only. Retention for rental applications: ID scans and dates of
 * birth of denied or withdrawn applications are deleted after `days`
 * (default 90). The database clears the rows and returns the files; this
 * removes them from disk.
 *
 * Exported, NOT scheduled yet. Wire it into the nightly job (or a Coolify
 * Scheduled Task) once the owner signs off on the 90 days.
 */
import { serviceDb } from "@/lib/server/session";
import { removeObject } from "@/lib/server/storage";

export async function purgeClosedApplicationPii(days = 90) {
  const { data, error } = await serviceDb().rpc("purge_closed_application_pii", { p_days: days });
  if (error) throw error;
  for (const file of data ?? []) await removeObject(file.org_id, "applications", file.path);
  return (data ?? []).length;
}
