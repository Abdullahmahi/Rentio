import { createFileRoute } from "@tanstack/react-router";
import { DoorOpen } from "lucide-react";
import i18n from "@/lib/i18n";
import { PlaceholderPage } from "@/components/rentio/placeholder-page";

export const Route = createFileRoute("/app/units")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.units.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.units.description") },
    { property: "og:title", content: `${i18n.t("pages.units.title")} — Rentio` },
    { property: "og:description", content: i18n.t("pages.units.description") },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <PlaceholderPage pageKey="units" icon={DoorOpen} />,
});
