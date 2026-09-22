import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { homeFor, useAuth } from "@/lib/auth";
import { describeError, supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

const MIN_PASSWORD = 8;

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: `${i18n.t("auth.newPasswordTitle")} — Rentio` }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD)
      return setError(t("auth.errors.passwordTooShort", { min: MIN_PASSWORD }));
    if (password !== confirm) return setError(t("auth.errors.passwordMismatch"));
    setSubmitting(true);
    try {
      const { error: caught } = await supabase.auth.updateUser({ password });
      if (caught) throw caught;
      toast.success(t("auth.passwordUpdated"));
      void navigate({ to: homeFor(role), replace: true });
    } catch (caught) {
      setError(t(describeError(caught)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title={t("auth.newPasswordTitle")} description={t("auth.newPasswordDescription")}>
      <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.newPassword")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            className="h-12"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(error)}
          />
          <p className="text-xs text-muted-foreground">
            {t("auth.passwordHint", { min: MIN_PASSWORD })}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className="h-12"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
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
          {t("auth.savePassword")}
        </Button>
      </form>

      {/* This screen had no way out at all: someone arriving from a stale
          email was simply stuck. */}
      <Link
        to="/sign-in"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {t("auth.backToSignIn")}
      </Link>
    </AuthLayout>
  );
}
