import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SignIn } from "@clerk/tanstack-react-start";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { clerkAppearance, homeFor, useAuth } from "@/lib/auth";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/sign-in")({
  // Returned as a genuinely optional key so linking to /sign-in never has to
  // pass a search object.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({ meta: [{ title: pageTitle(i18n.t("auth.signIn")) }] }),
  component: SignInPage,
});

/**
 * The one door, for staff and tenants alike. There is deliberately no
 * staff/tenant toggle: the role comes off the profile after authentication
 * and `homeFor()` picks the shell. Clerk handles the credentials, Google
 * and password reset; this page only decides where a signed-in person goes.
 */
function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signOut, loading, user, role, noAccess } = useAuth();
  const { redirect } = Route.useSearch();
  const [unrecognised, setUnrecognised] = useState(false);

  useEffect(() => {
    if (loading || !user) return;

    // A valid login nobody gave access to: a Google sign-in by someone not in
    // this portfolio, say. Without this they ping-pong between the guard and
    // the shell forever. Sign them back out and say plainly we do not know them.
    if (noAccess) {
      setUnrecognised(true);
      void signOut();
      return;
    }
    if (!role) return;

    // `redirect` is an arbitrary in-app path, so it cannot be a literal route
    // type. Only same-origin paths are honoured.
    const target =
      redirect?.startsWith("/") && !redirect.startsWith("//") ? redirect : homeFor(role);
    void navigate({ to: target as "/app", replace: true });
  }, [loading, user, role, noAccess, redirect, navigate, signOut]);

  const here = `/sign-in${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`;

  return (
    <AuthLayout
      title={t("auth.signIn")}
      description={t("auth.signInDescription")}
      footer={
        <span className="text-muted-foreground">
          {t("auth.firstTimeHere")}{" "}
          <Link to="/request-access" className="font-medium text-primary hover:underline">
            {t("auth.activateYourAccount")}
          </Link>
        </span>
      }
    >
      {unrecognised ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <p className="font-medium">{t("auth.unrecognisedAccount")}</p>
          <Link to="/request-access" className="mt-1 inline-block font-medium hover:underline">
            {t("auth.requestAccessCta")}
          </Link>
        </div>
      ) : null}

      <div className="mt-8">
        <SignIn
          routing="hash"
          signUpUrl="/signup"
          forceRedirectUrl={here}
          appearance={clerkAppearance}
        />
      </div>
    </AuthLayout>
  );
}
