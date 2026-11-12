import { createFileRoute } from "@tanstack/react-router";
import { ContactSentence, LegalPage } from "@/components/marketing/legal-page";
import { pageTitle } from "@/lib/brand";
import { CONTACT_EMAIL, LEGAL_ENTITY } from "@/lib/marketing";

/*
 * English only for now (audit.md §8 gate 5), and plain language, not reviewed
 * by an attorney yet. Every fact here must stay true of the code: if a vendor
 * is added (e.g. Stripe), add it to "Who else handles it" in the same change.
 */
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: pageTitle("Privacy") },
      { name: "description", content: "How Rentio handles property and tenant data." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="Last updated 28 October 2026">
      <p>
        Rentio is software that property management companies use to run their rentals. Tenants use
        it through the company that manages their home. Rentio is operated by {LEGAL_ENTITY}.
      </p>

      <h2>Whose data it is</h2>
      <p>
        Everything a property management company puts into Rentio, including its properties, leases,
        payments and its tenants&apos; details, belongs to that company. We hold and process it on
        the company&apos;s behalf, only to run the service for them.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email, phone number and preferred language.</li>
        <li>
          Records your staff enter: properties, units, tenants, leases, invoices, payments, expenses
          and work orders.
        </li>
        <li>Files you or your tenants upload, such as payment photos and maintenance photos.</li>
        <li>Basic server logs (IP address, time, page) used for security and fixing errors.</li>
      </ul>
      <p>
        This website runs no advertising trackers. If you book a call, the booking is handled by
        Cal.com.
      </p>

      <h2>Where it is stored</h2>
      <p>
        Data and uploaded files are stored on a server we run ourselves. Each company&apos;s records
        are kept separate from every other company&apos;s, and a test suite checks that one company
        cannot read another&apos;s data.
      </p>

      <h2>Who else handles it</h2>
      <ul>
        <li>Clerk, for sign-in and account security.</li>
        <li>Resend, to send email such as invitations and invoices.</li>
        <li>Cal.com, when you book a call from this website.</li>
      </ul>

      <h2>What we never do</h2>
      <p>
        We do not sell data, use it for advertising, or share one company&apos;s data with another.
      </p>

      <h2>Keeping and deleting it</h2>
      <p>
        We keep a company&apos;s data while it is a customer. When a company leaves, we export every
        unit, tenant, lease and payment for it within 2 business days, and delete its data when it
        asks us to.
      </p>

      <h2>If you are a tenant</h2>
      <p>
        Your property manager controls your records in Rentio. Ask them first to see, correct or
        delete your information; we will help them do it.
      </p>

      <h2>Questions</h2>
      <p>
        Write to <ContactSentence entity={LEGAL_ENTITY} email={CONTACT_EMAIL} />.
      </p>
    </LegalPage>
  );
}
