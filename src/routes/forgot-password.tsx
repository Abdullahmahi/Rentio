import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandPanel } from "@/components/rentio/brand-panel";
import { describeError, supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: `${i18n.t("auth.forgotPassword")} — Rentio` }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim()) return setError(t("auth.errors.emailRequired"));
    setSubmitting(true);
    try {
      const { error: caught } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (caught) throw caught;
      setSent(true);
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
          <h1 className="text-2xl font-semibold">{t("auth.forgotPasswordTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.forgotPasswordDescription")}
          </p>

          {sent ? (
            <div className="mt-8 rounded-lg border border-success/25 bg-success/10 p-4">
              <MailCheck className="size-5 text-success" />
              <p className="mt-2 text-sm font-medium text-foreground">{t("auth.resetEmailSent")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("auth.resetEmailSentHint")}</p>
            </div>
          ) : (
            <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className="h-12"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
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
                {t("auth.sendResetLink")}
              </Button>
            </form>
          )}

          <Link
            to="/login"
            className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
          >
            {t("auth.backToSignIn")}
          </Link>
        </div>
      </div>
      <BrandPanel icon={KeyRound} />
    </div>
  );
}
