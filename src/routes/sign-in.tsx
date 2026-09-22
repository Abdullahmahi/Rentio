import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { OAuthButtons } from "@/components/rentio/oauth-buttons";
import { homeFor, useAuth } from "@/lib/auth";
import { describeError, isSupabaseConfigured, supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/sign-in")({
  // Returned as a genuinely optional key so linking to /sign-in never has to
  // pass a search object.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({ meta: [{ title: `${i18n.t("auth.signIn")} — Rentio` }] }),
  component: SignInPage,
});

/**
 * The one door, for staff and tenants alike. There is deliberately no
 * staff/tenant toggle: the role comes off the profile after authentication
 * and `homeFor()` picks the shell. Asking someone to classify themselves
 * before they have proved who they are is a question they can get wrong.
 */
function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signIn, signOut, loading, user, profile, role } = useAuth();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unrecognised, setUnrecognised] = useState(false);

  // Already signed in — go straight to the right shell.
  useEffect(() => {
    if (loading || !user) return;

    // Authenticated with no profile. A Google sign-in by someone who is not
    // in this portfolio lands here: auth.users has a row, profiles does not,
    // so there is no role and every guard bounces them. Without this they
    // ping-pong between the guard and the shell forever. Sign them back out
    // and say plainly that we do not know them.
    if (!profile) {
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
  }, [loading, user, profile, role, redirect, navigate, signOut]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setUnrecognised(false);
    if (!email.trim()) return setError(t("auth.errors.emailRequired"));
    if (!password) return setError(t("auth.errors.passwordRequired"));
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      // The effect above routes once the profile resolves.
    } catch (caught) {
      setError(t(describeError(caught)));
    } finally {
      setSubmitting(false);
    }
  };

  const onOAuth = async (provider: "google") => {
    setError(null);
    setUnrecognised(false);
    const { error: caught } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/sign-in` },
    });
    if (caught) setError(t(describeError(caught)));
  };

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
      {!isSupabaseConfigured ? (
        <p className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t("errors.notConfiguredTitle")}
        </p>
      ) : null}

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

      <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-12"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-12"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </div>

        {error ? (
          <p
            id="signin-error"
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("auth.signIn")}
        </Button>
      </form>

      <OAuthButtons onSelect={(provider) => void onOAuth(provider)} />

      <Link
        to="/forgot-password"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {t("auth.forgotPassword")}
      </Link>
    </AuthLayout>
  );
}
