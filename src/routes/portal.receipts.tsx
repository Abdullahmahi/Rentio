import { createFileRoute } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import i18n from "@/lib/i18n";
import { PlaceholderPage } from "@/components/rentio/placeholder-page";

export const Route = createFileRoute("/portal/receipts")({
  head: () => ({ meta: [
    { title: `${i18n.t("pages.receipts.title")} — Rentio` },
    { name: "description", content: i18n.t("pages.receipts.description") },
    { property: "og:title", content: `${i18n.t("pages.receipts.title")} — Rentio` },
    { property: "og:description", content: i18n.t("pages.receipts.description") },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: () => <PlaceholderPage pageKey="receipts" icon={ReceiptText} />,
});
