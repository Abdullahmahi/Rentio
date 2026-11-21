import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SignIn, SignUp } from "@clerk/tanstack-react-start";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { clerkAppearance, homeFor, useAuth } from "@/lib/auth";
import { invokeFn } from "@/lib/db";
import i18n from "@/lib/i18n";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/apply/$slug")({
  validateSearch: (search: Record<string, unknown>): { link?: string } =>
    typeof search["link"] === "string" ? { link: search["link"] } : {},
  head: () => ({ meta: [{ title: pageTitle(i18n.t("applications.apply.title")) }] }),
  component: ApplyPage,
});

const ERRORS: Record<string, string> = {
  invalid_link: "applications.apply.invalidLink",
  account_exists: "applications.apply.accountExists",
  other_company: "applications.apply.otherCompany",
  email_not_verified: "applications.apply.emailNotVerified",
};

/**
 * The door an application link opens: /apply/<org-slug>?link=<token>.
 * Signed out, Clerk's sign-up (or sign-in) card. Signed in with no profile,
 * or as an applicant, the server opens the application and the login lands
 * on /apply/status. Staff and tenants are told their email is taken.
 */
function ApplyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug } = Route.useParams();
  const { link } = Route.useSearch();
  const { loading, user, role, noAccess, refreshProfile } = useAuth();
  const [mode, setMode] = useState<"signUp" | "signIn">("signUp");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const canStart = Boolean(user) && !loading && (noAccess || role === "applicant");

  useEffect(() => {
    if (!canStart || started.current) return;
    started.current = true;
    void (async () => {
      const { error: caught } = await invokeFn("start-application", { body: { slug, link } });
      if (caught) return setError(ERRORS[caught.message] ?? "applications.apply.failed");
      await refreshProfile();
      void navigate({ to: "/apply/status", replace: true });
    })();
  }, [canStart, slug, link, refreshProfile, navigate]);

  const here = typeof window === "undefined" ? `/apply/${slug}` : window.location.href;
  const otherAccount = Boolean(user) && !loading && role && role !== "applicant";

  return (
    <AuthLayout
      title={t("applications.apply.title")}
      description={t("applications.apply.description")}
      footer={<p className="text-muted-foreground">{t("applications.apply.oneEmail")}</p>}
    >
      <div className="mt-8">
        {!link ? (
          <p role="alert" className="text-sm text-danger">
            {t("applications.apply.invalidLink")}
          </p>
        ) : error || otherAccount ? (
          <div role="alert" className="space-y-3 text-sm">
            <p className="text-danger">{t(error ?? "applications.apply.accountExists")}</p>
            {otherAccount ? (
              <Link to={homeFor(role)} className="font-medium text-primary hover:underline">
                {t("actions.back")}
              </Link>
            ) : null}
          </div>
        ) : user || loading ? (
          <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("applications.apply.starting")}
          </div>
        ) : (
          <>
            {mode === "signUp" ? (
              <SignUp routing="hash" forceRedirectUrl={here} appearance={clerkAppearance} />
            ) : (
              <SignIn routing="hash" forceRedirectUrl={here} appearance={clerkAppearance} />
            )}
            <Button
              type="button"
              variant="link"
              className="mt-4 min-h-11 px-0"
              onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}
            >
              {mode === "signUp"
                ? t("applications.apply.signInInstead")
                : t("applications.apply.signUpInstead")}
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
