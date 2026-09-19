import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/rentio/placeholder-page";
import { Building2 } from "lucide-react";

export const Route = createFileRoute("/app/contracts/$id")({
  component: () => <PlaceholderPage pageKey="contracts" icon={Building2} />,
});
