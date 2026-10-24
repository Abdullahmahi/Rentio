import { createFileRoute, Link } from "@tanstack/react-router";
import { SignUp } from "@clerk/tanstack-react-start";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { clerkAppearance } from "@/lib/auth";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/activate")({
  validateSearch: (search: Record<string, unknown>): { email?: string } =>
    typeof search["email"] === "string" ? { email: search["email"] } : {},
  head: () => ({ meta: [{ title: pageTitle(i18n.t("auth.activateTitle")) }] }),
  component: ActivatePage,
});

/**
 * Where an invite email lands (src/lib/server/invite.ts). The person creates
 * their login with the invited address, prefilled; Clerk verifies it, and
 * their first request links the login to the profile staff created. Someone
 * who already has a login just signs in instead.
 */
function ActivatePage() {
  const { t } = useTranslation();
  const { email } = Route.useSearch();
  return (
    <AuthLayout title={t("auth.activateTitle")} description={t("auth.activateDescription")}>
      <div className="mt-8">
        <SignUp
          routing="hash"
          signInUrl="/sign-in"
          forceRedirectUrl="/sign-in"
          {...(email ? { initialValues: { emailAddress: email } } : {})}
          appearance={clerkAppearance}
        />
      </div>
      <Link
        to="/sign-in"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {t("auth.backToSignIn")}
      </Link>
    </AuthLayout>
  );
}
