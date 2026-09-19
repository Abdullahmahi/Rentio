import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/rentio/app-shell";
import { RequireRole } from "@/components/rentio/require-role";

export const Route = createFileRoute("/app")({
  component: () => (
    <RequireRole allow="staff">
      <AppShell />
    </RequireRole>
  ),
});
