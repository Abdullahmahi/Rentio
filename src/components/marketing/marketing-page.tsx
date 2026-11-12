import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { Proof } from "@/components/marketing/proof";
import { Bilingual } from "@/components/marketing/bilingual";
import { Compliance } from "@/components/marketing/compliance";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { Problem } from "@/components/marketing/problem";
import { AiLayer } from "@/components/marketing/ai-layer";
import { Offer } from "@/components/marketing/offer";
import { Faq } from "@/components/marketing/faq";
import { LateFeeAudit } from "@/components/marketing/late-fee-audit";

/**
 * The public page, in the order agreed in audit.md §6.2: the pain, what the
 * software does, the two differentiators that are live (bilingual, Texas
 * law), the night shift as a plan, proof that can be checked, the offer with
 * its price, the free audit, the objections, and the one ask.
 */
export function MarketingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <Problem />
        <Features />
        <Bilingual />
        <Compliance />
        <AiLayer />
        <Proof />
        <Offer />
        <LateFeeAudit />
        <Faq />
        <ClosingCta />
      </main>
      <Footer />
    </div>
  );
}
