import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/rentio/auth-layout";
import { supabase } from "@/lib/supabase";
import { usePublicSettings } from "@/lib/queries";
import { formatUsPhone } from "@/lib/us";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/request-access")({
  head: () => ({ meta: [{ title: `${i18n.t("auth.requestAccessTitle")} — Rentio` }] }),
  component: RequestAccessPage,
});

const EMPTY = { full_name: "", property_hint: "", unit_hint: "", email: "", phone: "" };

/**
 * The fallback for a tenant with no invite.
 *
 * This replaces the dead end in the old flow: the previous screen asked for
 * the email address the office had on file — which a tenant rarely knows —
 * and simply said nothing when there was no match. Here the details go into
 * a staff queue instead, and a human decides.
 *
 * The confirmation is identical whether or not anything matched. Saying "we
 * found you" would let a stranger test addresses against the landlord's
 * tenant list one submission at a time.
 */
function RequestAccessPage() {
  const { t } = useTranslation();
  const settings = usePublicSettings();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof EMPTY, value: string) => setForm({ ...form, [key]: value });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!form.full_name.trim()) return setError(t("auth.errors.nameRequired"));
    if (!form.email.trim()) return setError(t("auth.errors.emailRequired"));
    setSubmitting(true);
    try {
      await supabase.functions.invoke("submit-access-request", { body: form });
    } catch (caught) {
      // Same neutral confirmation even on a transport failure: a visible
      // difference here leaks exactly what the endpoint refuses to.
      console.warn("submit-access-request", caught);
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  };

  const email = settings.data?.email;
  const phone = settings.data?.phone;

  return (
    <AuthLayout
      title={t("auth.requestAccessTitle")}
      description={t("auth.requestAccessDescription")}
      footer={
        email || phone ? (
          <span className="text-muted-foreground">
            {t("auth.contactManager")}{" "}
            {email ? (
              <a className="font-medium text-primary hover:underline" href={`mailto:${email}`}>
                {email}
              </a>
            ) : null}
            {email && phone ? " · " : null}
            {phone ? (
              <a
                className="numeric font-medium text-primary hover:underline"
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
              >
                {phone}
              </a>
            ) : null}
          </span>
        ) : null
      }
    >
      {sent ? (
        <div className="mt-8 rounded-lg border border-success/25 bg-success/10 p-4">
          <MailCheck className="size-5 text-success" />
          <p className="mt-2 text-sm font-medium text-foreground">{t("auth.requestAccessSent")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.requestAccessSentHint")}</p>
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="full-name">{t("auth.fields.fullName")}</Label>
            <Input
              id="full-name"
              autoComplete="name"
              className="h-12"
              value={form.full_name}
              onChange={(event) => set("full_name", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="property">{t("auth.fields.property")}</Label>
            <Input
              id="property"
              autoComplete="street-address"
              className="h-12"
              placeholder={t("auth.fields.propertyPlaceholder")}
              value={form.property_hint}
              onChange={(event) => set("property_hint", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit">{t("auth.fields.unit")}</Label>
            <Input
              id="unit"
              className="h-12"
              value={form.unit_hint}
              onChange={(event) => set("unit_hint", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              className="h-12"
              placeholder="you@company.com"
              value={form.email}
              onChange={(event) => set("email", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">{t("auth.fields.phone")}</Label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              className="h-12"
              placeholder="(915) 555-0123"
              value={form.phone}
              onChange={(event) => set("phone", formatUsPhone(event.target.value))}
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
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("auth.requestAccessSubmit")}
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
