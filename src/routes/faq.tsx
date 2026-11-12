import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { Faq } from "@/components/marketing/faq";
import { ClosingCta } from "@/components/marketing/closing-cta";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: pageTitle(i18n.t("marketing:nav.faq")) },
      { name: "description", content: i18n.t("marketing:faq.description") },
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Faq full />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
