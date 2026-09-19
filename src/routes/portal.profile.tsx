import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/rentio/empty-state";
import { Field } from "@/components/rentio/form-dialog";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { useAuth } from "@/lib/auth";
import { LANGUAGE_STORAGE_KEY, type AppLanguage } from "@/lib/i18n";
import { useMyTenant, useToastMutation } from "@/lib/queries";
import { describeError, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/portal/profile")({
  head: () => ({ meta: [{ title: `${i18n.t("pages.profile.title")} — Rentio` }] }),
  component: PortalProfile,
});

const THEME_STORAGE_KEY = "rentio-theme";
const MIN_PASSWORD = 8;

function PortalProfile() {
  const { t, i18n: i18nInstance } = useTranslation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const tenant = useMyTenant();

  const [form, setForm] = useState({ phone: "", email: "", emergency_contact_name: "", emergency_contact_phone: "" });
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (!tenant.data) return;
    setForm({
      phone: tenant.data.phone ?? "",
      email: tenant.data.email ?? "",
      emergency_contact_name: tenant.data.emergency_contact_name ?? "",
      emergency_contact_phone: tenant.data.emergency_contact_phone ?? "",
    });
  }, [tenant.data]);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) === "dark";
    setDark(stored);
    document.documentElement.classList.toggle("dark", stored);
  }, []);

  // Only these four columns are writable by a tenant — a trigger enforces it
  // server-side, so the form matches what the database will actually accept.
  const save = useToastMutation({
    mutationFn: async () => {
      if (!tenant.data) throw new Error("no-tenant");
      const { error: caught } = await supabase.from("tenants").update({
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        emergency_contact_name: form.emergency_contact_name.trim() || null,
        emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      }).eq("id", tenant.data.id);
      if (caught) throw caught;
    },
    successKey: "portal.profileSaved",
    invalidate: [["my-tenant"]],
  });

  const changePassword = useToastMutation({
    mutationFn: async () => {
      const { error: caught } = await supabase.auth.updateUser({ password: password.next });
      if (caught) throw caught;
    },
    successKey: "auth.passwordUpdated",
    onSuccess: () => setPassword({ next: "", confirm: "" }),
  });

  const setLanguage = (language: AppLanguage) => {
    void i18nInstance.changeLanguage(language);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
  };

  const toggleTheme = () => {
    setDark((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("pages.profile.title")} description={t("portal.profileHint")} />

      <QueryState
        isLoading={tenant.isLoading}
        error={tenant.error}
        isEmpty={!tenant.data && !tenant.isLoading}
        onRetry={() => void tenant.refetch()}
        skeleton={<RowsSkeleton count={4} />}
        empty={<EmptyState message={t("tenants.notFound")} description={t("portal.noLeaseDescription")} />}
      >
        <form
          className="space-y-4 rounded-lg border border-border bg-surface p-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
              return setError(t("tenants.errors.emailInvalid"));
            }
            save.mutate(undefined);
          }}
        >
          <h2 className="text-base font-semibold">{t("tenants.contactTitle")}</h2>
          <Field label={t("tenants.fields.phone")} htmlFor="profile-phone">
            <Input id="profile-phone" inputMode="tel" className="numeric h-12" value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field label={t("tenants.fields.email")} htmlFor="profile-email">
            <Input id="profile-email" type="email" className="h-12" value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field label={t("tenants.fields.emergencyName")} htmlFor="profile-ename">
            <Input id="profile-ename" className="h-12" value={form.emergency_contact_name}
              onChange={(event) => setForm({ ...form, emergency_contact_name: event.target.value })} />
          </Field>
          <Field label={t("tenants.fields.emergencyPhone")} htmlFor="profile-ephone">
            <Input id="profile-ephone" inputMode="tel" className="numeric h-12" value={form.emergency_contact_phone}
              onChange={(event) => setForm({ ...form, emergency_contact_phone: event.target.value })} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}
          <Button type="submit" className="h-12 w-full" disabled={save.isPending}>{t("actions.save")}</Button>
        </form>

        <form
          className="space-y-4 rounded-lg border border-border bg-surface p-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setPasswordError(null);
            if (password.next.length < MIN_PASSWORD) {
              return setPasswordError(t("auth.errors.passwordTooShort", { min: MIN_PASSWORD }));
            }
            if (password.next !== password.confirm) return setPasswordError(t("auth.errors.passwordMismatch"));
            changePassword.mutate(undefined);
          }}
        >
          <h2 className="text-base font-semibold">{t("portal.changePassword")}</h2>
          <Field label={t("auth.newPassword")} htmlFor="profile-password">
            <Input id="profile-password" type="password" autoComplete="new-password" className="h-12" value={password.next}
              onChange={(event) => setPassword({ ...password, next: event.target.value })} />
          </Field>
          <Field label={t("auth.confirmPassword")} htmlFor="profile-confirm">
            <Input id="profile-confirm" type="password" autoComplete="new-password" className="h-12" value={password.confirm}
              onChange={(event) => setPassword({ ...password, confirm: event.target.value })} />
          </Field>
          {passwordError ? (
            <p role="alert" className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{passwordError}</p>
          ) : null}
          <Button type="submit" variant="outline" className="h-12 w-full" disabled={changePassword.isPending}>
            {t("auth.savePassword")}
          </Button>
        </form>

        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">{t("portal.preferences")}</h2>

          <div>
            <p className="text-sm font-medium">{t("actions.changeLanguage")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["es-MX", "en"] as const).map((language) => (
                <button
                  key={language}
                  type="button"
                  onClick={() => setLanguage(language)}
                  aria-pressed={i18nInstance.language === language}
                  className={cn("h-12 rounded-lg border text-sm font-medium",
                    i18nInstance.language === language
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-surface hover:bg-muted")}
                >
                  {language === "es-MX" ? "Español" : "English"}
                </button>
              ))}
            </div>
          </div>

          <Button variant="outline" className="h-12 w-full" onClick={toggleTheme}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {t(dark ? "theme.light" : "theme.dark")}
          </Button>
        </section>

        <Button
          variant="outline"
          className="h-12 w-full text-danger"
          onClick={() => {
            void signOut()
              .then(() => navigate({ to: "/login", replace: true }))
              .catch((caught) => toast.error(t(describeError(caught))));
          }}
        >
          <LogOut className="size-4" />{t("actions.signOut")}
        </Button>
      </QueryState>
    </div>
  );
}
