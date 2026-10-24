import { createFileRoute, Link } from "@tanstack/react-router";
import { SignUp } from "@clerk/tanstack-react-start";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { clerkAppearance } from "@/lib/auth";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: pageTitle(i18n.t("auth.signUp")) }] }),
  component: SignUpPage,
});

/**
 * Tenant self-enrollment, not open registration. Anyone can create a login,
 * but it only opens a portal if Clerk has verified an email that is on a
 * lease in this portfolio (src/lib/server/session.ts). Anyone else lands on
 * /sign-in's "we don't recognise this account". Nothing on this page reveals
 * whether an address matched.
 */
function SignUpPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t("auth.signUpTitle")} description={t("auth.signUpDescription")}>
      <div className="mt-8">
        <SignUp
          routing="hash"
          signInUrl="/sign-in"
          forceRedirectUrl="/sign-in"
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
