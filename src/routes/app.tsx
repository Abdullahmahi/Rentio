import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/rentio/app-shell";
export const Route = createFileRoute("/app")({ component: AppShell });
