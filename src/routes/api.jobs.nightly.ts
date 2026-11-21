import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { runAllAutomations } from "@/lib/server/automations";
import { fail, serviceDb } from "@/lib/server/session";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Constant-time compare; hashing first evens out the lengths. */
function secretMatches(given: string | null) {
  const expected = process.env["CRON_SECRET"] ?? "";
  if (expected.length < 16 || !given) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The scheduled entry point. Coolify runs it daily:
 *   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/jobs/nightly
 *
 * Every active company is run separately, with its own settings.auto_*
 * (the Automations page), and gets its own job_runs row; one company
 * failing never stops the others. See src/lib/server/automations.ts.
 * Idempotent.
 */
export const Route = createFileRoute("/api/jobs/nightly")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!secretMatches(request.headers.get("x-cron-secret")))
          return json({ error: "unauthorized" }, 401);
        try {
          const summary = await runAllAutomations(serviceDb());
          console.info("nightly", JSON.stringify(summary));
          return json(summary);
        } catch (caught) {
          return fail(caught, "nightly");
        }
      },
    },
  },
});
