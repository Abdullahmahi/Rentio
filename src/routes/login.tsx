import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandPanel } from "@/components/rentio/brand-panel";
import { homeFor, useAuth } from "@/lib/auth";
import { describeError, isSupabaseConfigured } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  // Returned as a genuinely optional key so linking to /login never has to
  // pass a search object.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {},
  head: () => ({ meta: [{ title: `${i18n.t("auth.signIn")} — Rentio` }] }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signIn, loading, user, role } = useAuth();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already signed in — go straight to the right shell.
  useEffect(() => {
    if (loading || !user || !role) return;
    // `redirect` is an arbitrary in-app path, so it cannot be a literal route
    // type. Only same-origin paths are honoured.
    const target =
      redirect?.startsWith("/") && !redirect.startsWith("//") ? redirect : homeFor(role);
    void navigate({ to: target as "/app", replace: true });
  }, [loading, user, role, redirect, navigate]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
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

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              R
            </div>
            <div>
              <div className="text-base font-semibold">{t("brand.name")}</div>
              <div className="text-xs text-muted-foreground">{t("brand.internal")}</div>
            </div>
          </div>

          <h1 className="mt-8 text-2xl font-semibold">{t("auth.signIn")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.signInDescription")}</p>

          {!isSupabaseConfigured ? (
            <p className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {t("errors.notConfigured")}
            </p>
          ) : null}

          <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                className="h-12"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error)}
                placeholder="you@company.com"
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
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {error}
              </p>
            ) : null}

            <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {t("auth.signIn")}
            </Button>
          </form>

          <div className="mt-2 flex flex-wrap items-center gap-x-5">
            <Link
              to="/forgot-password"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              {t("auth.forgotPassword")}
            </Link>
            <Link
              to="/signup"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              {t("auth.tenantSignUpLink")}
            </Link>
          </div>

          <p className="mt-8 text-xs text-muted-foreground">{t("auth.noSignup")}</p>
        </div>
      </div>

      <BrandPanel icon={Building2} />
    </div>
  );
}
