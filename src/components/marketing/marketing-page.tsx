import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { Proof } from "@/components/marketing/proof";
import { Bilingual } from "@/components/marketing/bilingual";
import { Compliance } from "@/components/marketing/compliance";
import { ClosingCta } from "@/components/marketing/closing-cta";

/**
 * The public page. Section order is the argument: what it is, what it does,
 * what it looks like, why it is different, what the law requires, and then
 * the one thing we are asking for.
 */
export function MarketingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Proof />
        <Bilingual />
        <Compliance />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
