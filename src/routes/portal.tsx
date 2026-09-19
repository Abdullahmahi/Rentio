import { createFileRoute } from "@tanstack/react-router";
import { PortalShell } from "@/components/rentio/portal-shell";
export const Route = createFileRoute("/portal")({ component: PortalShell });
