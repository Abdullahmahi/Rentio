import { createFileRoute } from "@tanstack/react-router";
import { CarFront } from "lucide-react";
import i18n from "@/lib/i18n";
import { PlaceholderPage } from "@/components/rentio/placeholder-page";

export const Route = createFileRoute("/app/parking")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.parking.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.parking.description") },
    { property: "og:title", content: `${i18n.t("pages.parking.title")} — Rentio` },
    { property: "og:description", content: i18n.t("pages.parking.description") },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <PlaceholderPage pageKey="parking" icon={CarFront} />,
});
