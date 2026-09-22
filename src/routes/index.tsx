import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { homeFor, useAuth } from "@/lib/auth";
import { MarketingPage } from "@/components/marketing/marketing-page";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: `Rentio — ${i18n.t("marketing:hero.headlineLead")} ${i18n.t("marketing:hero.headlineEmphasis")}`,
      },
      { name: "description", content: i18n.t("marketing:hero.subhead") },
    ],
  }),
  component: IndexRoute,
});

/**
 * Signed out, this is the sales page. Signed in, it forwards to the portal —
 * an existing customer should never land on the pitch.
 *
 * Redirecting in `beforeLoad` is still not an option: the session only exists
 * client-side. What changed is the loading state. It used to render an empty
 * div, which was right when every visitor was about to be redirected; now most
 * visitors are staying, so it renders the marketing page and the small number
 * who are signed in get moved off it a moment later.
 */
function IndexRoute() {
  const { loading, user, role } = useAuth();
  const navigate = useNavigate();
  const signedIn = Boolean(user && role);

  useEffect(() => {
    if (loading || !signedIn || !role) return;
    void navigate({ to: homeFor(role), replace: true });
  }, [loading, signedIn, role, navigate]);

  return <MarketingPage />;
}
