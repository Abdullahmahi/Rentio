import { createFileRoute } from "@tanstack/react-router";
import { VslPage } from "@/components/marketing/vsl-page";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

/**
 * Where a visitor lands after booking the walkthrough. Two ways in: the
 * Cal.com popup on our own pages navigates here on `bookingSuccessfulV2`
 * (booking-link.tsx), and a booking made on cal.com directly arrives through
 * the event's "redirect on booking" setting, whose "forward parameters"
 * option adds `?name=`. Only the first name is used, for the headline. Not indexed: it only makes sense
 * after booking, and robots.txt disallows it too.
 */
export const Route = createFileRoute("/vsl")({
  validateSearch: (search: Record<string, unknown>): { name?: string | undefined } => {
    const first = typeof search["name"] === "string" ? search["name"].trim().split(/\s+/)[0] : "";
    return first ? { name: first } : {};
  },
  head: () => ({
    meta: [
      { title: pageTitle(i18n.t("marketing:booked.title")) },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BookedRoute,
});

function BookedRoute() {
  const { name } = Route.useSearch();
  return <VslPage name={name} />;
}
