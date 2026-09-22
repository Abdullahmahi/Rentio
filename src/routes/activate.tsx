import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { homeFor, useAuth } from "@/lib/auth";
import { describeError, supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/activate")({
  head: () => ({ meta: [{ title: `${i18n.t("auth.activateTitle")} — Rentio` }] }),
  component: ActivatePage,
});

const MIN_PASSWORD = 8;

/**
 * Where an invite link lands.
 *
 * No `?token=` of our own: a Supabase invite arrives as
 * `/activate#access_token=…&type=invite`, and the client is configured with
 * `detectSessionInUrl`, so by the time this renders the session already
 * exists. That means the greeting can be read through ordinary RLS — no
 * token table, no signing key to rotate, nothing to replay.
 *
 * The greeting matters: a tenant needs to see their own name and unit before
 * they set a password, so a misdirected invite is obvious rather than
 * discovered later.
 */
function ActivatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, role, loading } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  // The tenant's own unit, via the view the portal already uses. Staff
  // invites have no lease, so this simply comes back empty for them.
  const lease = useQuery({
    queryKey: ["activate-lease", user?.id],
    enabled: Boolean(user && profile?.tenant_id),
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("my_lease_details")
        .select("unit_number, property_name")
        .limit(1)
        .maybeSingle();
      if (caught) throw caught;
      return data;
    },
  });

  const setNewPassword = async (event: FormEvent) => {
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

  // No session means the link was already used or has expired. Supabase
  // invite links are single use, so this is the common case for anyone who
  // clicks twice.
  if (!loading && !user) return <ExpiredLink resent={resent} onResent={() => setResent(true)} />;

  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  const unitLabel =
    lease.data?.unit_number != null
      ? [t("units.columns.unit"), lease.data.unit_number].join(" ") +
        (lease.data.property_name ? ` · ${lease.data.property_name}` : "")
      : null;

  return (
    <AuthLayout
      title={firstName ? t("auth.activateWelcome", { name: firstName }) : t("auth.activateTitle")}
      description={t("auth.activateDescription")}
    >
      {unitLabel ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium">
          {unitLabel}
        </p>
      ) : null}

      <form className="mt-8 space-y-4" onSubmit={setNewPassword} noValidate>
        <div className="space-y-2">
          <Label htmlFor="password">{t("auth.newPassword")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            className="h-12"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
            aria-describedby={error ? "activate-error" : undefined}
          />
        </div>

        {error ? (
          <p
            id="activate-error"
            role="alert"
            className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("auth.savePassword")}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Expired or already-used link. Offers a fresh one rather than a dead end. */
function ExpiredLink({ resent, onResent }: { resent: boolean; onResent: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const resend = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      // Reuses the self-enrollment endpoint, which already sends a recovery
      // link rather than a second invite when the account exists.
      await supabase.functions.invoke("tenant-self-enroll", { body: { email: email.trim() } });
    } catch (caught) {
      console.warn("tenant-self-enroll", caught);
    } finally {
      setSending(false);
      onResent();
    }
  };

  return (
    <AuthLayout title={t("auth.linkExpiredTitle")} description={t("auth.linkExpiredDescription")}>
      {resent ? (
        <div className="mt-8 rounded-lg border border-success/25 bg-success/10 p-4">
          <MailCheck className="size-5 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">{t("auth.signUpSent")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.signUpSentHint")}</p>
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={resend} noValidate>
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
          <Button type="submit" className="h-12 w-full text-base" disabled={sending}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("auth.sendNewLink")}
          </Button>
        </form>
      )}

      <Link
        to="/sign-in"
        className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {t("auth.backToSignIn")}
      </Link>
    </AuthLayout>
  );
}
