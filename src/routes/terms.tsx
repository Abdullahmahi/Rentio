import { createFileRoute } from "@tanstack/react-router";
import { ContactSentence, LegalPage } from "@/components/marketing/legal-page";
import { pageTitle } from "@/lib/brand";
import { CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/marketing";

/*
 * English only for now (audit.md §8 gate 5). A plain-language summary, not
 * reviewed by an attorney yet; the signed agreement with each company wins.
 */
export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: pageTitle("Terms") },
      { name: "description", content: "The plain-language terms for using Rentio." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms" updated="Last updated 28 October 2026">
      <p>
        These terms cover the use of Rentio, operated by {LEGAL_ENTITY}, by property management
        companies, their staff and their tenants. If your company has signed an agreement with us,
        that agreement takes priority over this page.
      </p>

      <h2>The service</h2>
      <p>
        Rentio is property management software with a staff portal and a tenant portal, in English
        and Spanish. Access is by invitation from a property management company.
      </p>

      <h2>Your data</h2>
      <p>
        Your company owns the data it puts into Rentio. You allow us to store and process it only to
        provide the service. Ask at any time, or when you leave, and we export every unit, tenant,
        lease and payment for you within 2 business days.
      </p>

      <h2>Price and leaving</h2>
      <p>
        The price is the one in your order or agreement. There is no lock-in: you can leave any
        month.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Use Rentio lawfully and keep sign-in details private.</li>
        <li>You are responsible for the accounts you invite and the data you enter.</li>
        <li>Tell us promptly if you think an account has been misused.</li>
      </ul>

      <h2>Texas law</h2>
      <p>
        Rentio tracks statutory deadlines and warns you before they pass. It is not legal advice and
        does not guarantee compliance; decisions about notices, fees and deposits stay with you.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep Rentio running and your data backed up, but we cannot promise it will never
        be unavailable.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, our total liability is limited to the fees you paid us in the
        12 months before the claim.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of the State of Texas.</p>

      <h2>Questions</h2>
      <p>
        Write to <ContactSentence entity={LEGAL_ENTITY} email={CONTACT_EMAIL} />.
      </p>
    </LegalPage>
  );
}
