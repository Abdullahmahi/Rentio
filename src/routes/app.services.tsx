import { createFileRoute } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import i18n from "@/lib/i18n";
import { PlaceholderPage } from "@/components/rentio/placeholder-page";

export const Route = createFileRoute("/app/services")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.services.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.services.description") },
    { property: "og:title", content: `${i18n.t("pages.services.title")} — Rentio` },
    { property: "og:description", content: i18n.t("pages.services.description") },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <PlaceholderPage pageKey="services" icon={Zap} />,
});
