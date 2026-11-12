import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/marketing/legal-page";
import { BookingLink } from "@/components/marketing/booking-link";
import { pageTitle } from "@/lib/brand";
import { CONTACT_ADDRESS, CONTACT_EMAIL, CONTACT_PHONE, LEGAL_ENTITY } from "@/lib/marketing";

/* English only for now (audit.md §8 gate 5). Empty constants are not rendered. */
export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: pageTitle("Contact") },
      { name: "description", content: "How to reach the team behind Rentio." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const rows = [
    { label: "Company", value: LEGAL_ENTITY },
    {
      label: "Email",
      value: CONTACT_EMAIL,
      href: `mailto:${CONTACT_EMAIL}`,
    },
    {
      label: "Phone",
      value: CONTACT_PHONE,
      href: `tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}`,
    },
    { label: "Address", value: CONTACT_ADDRESS },
  ].filter((row) => row.value);

  return (
    <LegalPage title="Contact">
      <p>
        The quickest way to talk to us is a 30-minute walkthrough on your own portfolio. Pick a time
        that suits you.
      </p>
      <BookingLink size="lg">Book a 30-minute walkthrough</BookingLink>
      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 border-t border-border pt-6">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-medium text-foreground">{row.label}</dt>
              <dd className="whitespace-pre-line">
                {row.href ? <a href={row.href}>{row.value}</a> : row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </LegalPage>
  );
}
