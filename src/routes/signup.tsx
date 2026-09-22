import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Loader2, MailCheck, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandPanel } from "@/components/rentio/brand-panel";
import { supabase } from "@/lib/supabase";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: `${i18n.t("auth.signUp")} — Rentio` }] }),
  component: SignUpPage,
});

/**
 * Tenant self-enrollment, not open registration. The landlord still decides
 * who is a tenant; this only lets someone already on a lease set their own
 * password instead of waiting for an invite.
 *
 * The confirmation is deliberately the same whether or not the address
 * matched. Telling a stranger "that email is not a tenant here" hands them a
 * way to enumerate who rents from this landlord.
 */
function SignUpPage() {
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
      await supabase.functions.invoke("tenant-self-enroll", {
        body: { email: email.trim() },
      });
    } catch (caught) {
      // Even a transport failure shows the neutral confirmation: a visible
      // difference here would leak exactly what the endpoint refuses to.
      console.warn("tenant-self-enroll", caught);
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">{t("auth.signUpTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.signUpDescription")}</p>

          {sent ? (
            <div className="mt-8 rounded-lg border border-success/25 bg-success/10 p-4">
              <MailCheck className="size-5 text-success" />
              <p className="mt-2 text-sm font-medium text-foreground">{t("auth.signUpSent")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("auth.signUpSentHint")}</p>
            </div>
          ) : (
            <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signup-error" : undefined}
                />
              </div>

              {error ? (
                <p id="signup-error" role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="h-11 w-full" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <UserPlus className="size-4" />
                )}
                {t("auth.signUp")}
              </Button>
            </form>
          )}

          <Link
            to="/login"
            className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
          >
            {t("auth.backToSignIn")}
          </Link>

          <p className="mt-8 text-xs text-muted-foreground">{t("auth.signUpStaffNote")}</p>
        </div>
      </div>

      <BrandPanel icon={Building2} />
    </div>
  );
}
