import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/rentio/portal-shell";
import { RequireRole } from "@/components/rentio/require-role";

export const Route = createFileRoute("/portal")({
  component: () => (
    <RequireRole allow="tenant">
      <PortalShell />
    </RequireRole>
  ),
});
