import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Moon, Shield, Sun, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, FormDialog } from "@/components/rentio/form-dialog";
import { MoneyInput } from "@/components/rentio/money-input";
import { PageHeader } from "@/components/rentio/page-header";
import { QueryState, RowsSkeleton } from "@/components/rentio/query-state";
import { AdminOnly, useAuth } from "@/lib/auth";
import { INTERNAL_DEFAULT_LANGUAGE } from "@/lib/i18n";
import { DEFAULT_STATE, PHONE_HINT, US_STATES, formatUsPhone } from "@/lib/us";
import {
  logActivity,
  qk,
  useActorId,
  useLanguagePreference,
  useSettings,
  useToastMutation,
} from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Enums } from "@/lib/database.types";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/app/settings/")({
  head: () => ({
    meta: [
      { title: `${i18n.t("pages.settings.title")} — Rentio` },
      { name: "description", content: i18n.t("pages.settings.description") },
    ],
  }),
  component: SettingsPage,
});

const THEME_STORAGE_KEY = "rentio-theme";
const ROLES: Enums<"user_role">[] = ["admin", "manager"];

function SettingsPage() {
  const { t, i18n: i18nInstance } = useTranslation();
  const settings = useSettings();
  const actorId = useActorId();
  const { isAdmin } = useAuth();

  const [company, setCompany] = useState({
    company_name: "",
    street: "",
    address_line_2: "",
    city: "",
    state: DEFAULT_STATE,
    postal_code: "",
    phone: "",
    email: "",
  });
  // Every one of these is optional: a landlord will use two or three of them,
  // not all six. The portal renders only what is filled in.
  const [payTo, setPayTo] = useState({
    zelle_handle: "",
    check_payable_to: "",
    check_mailing_address: "",
    dropoff_address: "",
    office_hours: "",
    payment_notes: "",
  });
  const [invoicing, setInvoicing] = useState({
    invoice_prefix: "REC",
    default_grace_days: "5",
    default_late_fee: 0 as number | "",
    nsf_fee: 0 as number | "",
  });
  const [dark, setDark] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({
    email: "",
    full_name: "",
    role: "manager" as Enums<"user_role">,
  });
  const [error, setError] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ["staff-users"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error: caught } = await supabase
        .from("profiles")
        .select("*")
        .in("role", ["admin", "manager"])
        .order("full_name");
      if (caught) throw caught;
      return data;
    },
  });

  useEffect(() => {
    if (!settings.data) return;
    setCompany({
      company_name: settings.data.company_name ?? "",
      street: settings.data.street ?? "",
      address_line_2: settings.data.address_line_2 ?? "",
      city: settings.data.city ?? "",
      state: settings.data.state ?? DEFAULT_STATE,
      postal_code: settings.data.postal_code ?? "",
      phone: settings.data.phone ?? "",
      email: settings.data.email ?? "",
    });
    setPayTo({
      zelle_handle: settings.data.zelle_handle ?? "",
      check_payable_to: settings.data.check_payable_to ?? "",
      check_mailing_address: settings.data.check_mailing_address ?? "",
      dropoff_address: settings.data.dropoff_address ?? "",
      office_hours: settings.data.office_hours ?? "",
      payment_notes: settings.data.payment_notes ?? "",
    });
    setInvoicing({
      invoice_prefix: settings.data.invoice_prefix ?? "REC",
      default_grace_days: String(settings.data.default_grace_days ?? 5),
      default_late_fee: Number(settings.data.default_late_fee ?? 0),
      nsf_fee: Number(settings.data.nsf_fee ?? 0),
    });
  }, [settings.data]);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) === "dark";
    setDark(stored);
    document.documentElement.classList.toggle("dark", stored);
  }, []);

  const save = useToastMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!settings.data) throw new Error("no-settings");
      const { error: caught } = await supabase
        .from("settings")
        .update(patch as never)
        .eq("id", settings.data.id);
      if (caught) throw caught;
      await logActivity(actorId, "settings", settings.data.id, "update", {
        keys: Object.keys(patch),
      });
    },
    successKey: "settings.saved",
    invalidate: [qk.settings, ["public-settings"]],
  });

  const uploadLogo = useToastMutation({
    mutationFn: async (file: File) => {
      if (!settings.data) throw new Error("no-settings");
      const path = await uploadFile("company", "logo", file);
      const { error: caught } = await supabase
        .from("settings")
        .update({ logo_url: path })
        .eq("id", settings.data.id);
      if (caught) throw caught;
    },
    successKey: "settings.logoSaved",
    invalidate: [qk.settings],
  });

  const changeRole = useToastMutation({
    mutationFn: async ({ id, role }: { id: string; role: Enums<"user_role"> }) => {
      const { error: caught } = await supabase.from("profiles").update({ role }).eq("id", id);
      if (caught) throw caught;
      await logActivity(actorId, "profile", id, "change_role", { role });
    },
    successKey: "settings.roleChanged",
    invalidate: [["staff-users"]],
  });

  const sendInvite = useToastMutation({
    mutationFn: async () => {
      // Creating an auth user needs the service role, so it lives in an edge function.
      const { error: caught } = await supabase.functions.invoke("send-staff-invite", {
        body: { email: invite.email.trim(), full_name: invite.full_name.trim(), role: invite.role },
      });
      if (caught) throw caught;
      await logActivity(actorId, "profile", null, "invite_staff", {
        email: invite.email,
        role: invite.role,
      });
    },
    successKey: "settings.inviteSent",
    invalidate: [["staff-users"]],
    onSuccess: () => {
      setInviteOpen(false);
      setInvite({ email: "", full_name: "", role: "manager" });
    },
  });

  const { setLanguage } = useLanguagePreference(INTERNAL_DEFAULT_LANGUAGE);

  const toggleTheme = () => {
    setDark((current) => {
      const next = !current;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.settings.title")} description={t("pages.settings.description")} />

      <QueryState
        isLoading={settings.isLoading}
        error={settings.error}
        onRetry={() => void settings.refetch()}
        skeleton={<RowsSkeleton count={6} />}
      >
        <Tabs defaultValue="company">
          <TabsList className="flex-wrap">
            <TabsTrigger value="company">{t("settings.tabs.company")}</TabsTrigger>
            <TabsTrigger value="payto">{t("settings.tabs.paymentInstructions")}</TabsTrigger>
            <TabsTrigger value="invoicing">{t("settings.tabs.invoicing")}</TabsTrigger>
            {isAdmin ? <TabsTrigger value="users">{t("settings.tabs.users")}</TabsTrigger> : null}
            <TabsTrigger value="preferences">{t("settings.tabs.preferences")}</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------- empresa */}
          <TabsContent value="company" className="mt-4">
            <form
              className="max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-5 shadow-subtle"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(company);
              }}
            >
              <Field label={t("settings.fields.companyName")} htmlFor="company-name">
                <Input
                  id="company-name"
                  value={company.company_name}
                  onChange={(event) => setCompany({ ...company, company_name: event.target.value })}
                />
              </Field>
              <Field
                label={t("settings.fields.logo")}
                htmlFor="company-logo"
                hint={t("settings.fields.logoHint")}
              >
                <Input
                  id="company-logo"
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadLogo.mutate(file);
                  }}
                />
              </Field>
              <Field label={t("properties.fields.street")} htmlFor="company-street">
                <Input
                  id="company-street"
                  value={company.street}
                  onChange={(event) => setCompany({ ...company, street: event.target.value })}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("properties.fields.addressLine2")} htmlFor="company-address-2">
                  <Input
                    id="company-address-2"
                    value={company.address_line_2}
                    onChange={(event) =>
                      setCompany({ ...company, address_line_2: event.target.value })
                    }
                  />
                </Field>
                <Field label={t("properties.fields.postalCode")} htmlFor="company-cp">
                  <Input
                    id="company-cp"
                    inputMode="numeric"
                    maxLength={5}
                    value={company.postal_code}
                    onChange={(event) =>
                      setCompany({ ...company, postal_code: event.target.value.replace(/\D/g, "") })
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("properties.fields.city")} htmlFor="company-city">
                  <Input
                    id="company-city"
                    value={company.city}
                    onChange={(event) => setCompany({ ...company, city: event.target.value })}
                  />
                </Field>
                <Field label={t("properties.fields.state")}>
                  <Select
                    value={company.state}
                    onValueChange={(value) => setCompany({ ...company, state: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {code} — {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("tenants.fields.phone")} htmlFor="company-phone" hint={PHONE_HINT}>
                  <Input
                    id="company-phone"
                    inputMode="tel"
                    className="numeric"
                    value={company.phone}
                    onChange={(event) =>
                      setCompany({ ...company, phone: formatUsPhone(event.target.value) })
                    }
                  />
                </Field>
                <Field label={t("tenants.fields.email")} htmlFor="company-email">
                  <Input
                    id="company-email"
                    type="email"
                    value={company.email}
                    onChange={(event) => setCompany({ ...company, email: event.target.value })}
                  />
                </Field>
              </div>
              <Button type="submit" disabled={save.isPending}>
                {t("actions.save")}
              </Button>
            </form>
          </TabsContent>

          {/* --------------------------------- payment instructions */}
          <TabsContent value="payto" className="mt-4">
            <form
              className="max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-5 shadow-subtle"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(payTo);
              }}
            >
              <p className="rounded-lg border border-info/25 bg-info/10 px-3 py-2 text-sm text-info">
                {t("settings.paymentInstructionsNotice")}
              </p>
              {/* No routing or account number field, deliberately. Publishing
                  one to 120 tenants invites unauthorized ACH debits; that
                  belongs behind a processor in Phase 2. */}
              <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                {t("settings.noBankNumbersNotice")}
              </p>
              <Field
                label={t("settings.fields.zelleHandle")}
                htmlFor="pay-zelle"
                hint={t("settings.fields.zelleHandleHint")}
              >
                <Input
                  id="pay-zelle"
                  value={payTo.zelle_handle}
                  onChange={(event) => setPayTo({ ...payTo, zelle_handle: event.target.value })}
                />
              </Field>
              <Field label={t("settings.fields.checkPayableTo")} htmlFor="pay-payable">
                <Input
                  id="pay-payable"
                  value={payTo.check_payable_to}
                  onChange={(event) => setPayTo({ ...payTo, check_payable_to: event.target.value })}
                />
              </Field>
              <Field label={t("settings.fields.checkMailingAddress")} htmlFor="pay-mailing">
                <Textarea
                  id="pay-mailing"
                  rows={3}
                  value={payTo.check_mailing_address}
                  onChange={(event) =>
                    setPayTo({ ...payTo, check_mailing_address: event.target.value })
                  }
                />
              </Field>
              <Field
                label={t("settings.fields.dropoffAddress")}
                htmlFor="pay-dropoff"
                hint={t("settings.fields.dropoffAddressHint")}
              >
                <Textarea
                  id="pay-dropoff"
                  rows={2}
                  value={payTo.dropoff_address}
                  onChange={(event) => setPayTo({ ...payTo, dropoff_address: event.target.value })}
                />
              </Field>
              <Field label={t("settings.fields.officeHours")} htmlFor="pay-hours">
                <Input
                  id="pay-hours"
                  value={payTo.office_hours}
                  onChange={(event) => setPayTo({ ...payTo, office_hours: event.target.value })}
                />
              </Field>
              <Field
                label={t("settings.fields.paymentNotes")}
                htmlFor="pay-notes"
                hint={t("settings.fields.paymentNotesHint")}
              >
                <Textarea
                  id="pay-notes"
                  rows={3}
                  value={payTo.payment_notes}
                  onChange={(event) => setPayTo({ ...payTo, payment_notes: event.target.value })}
                />
              </Field>
              <Button type="submit" disabled={save.isPending}>
                {t("actions.save")}
              </Button>
            </form>
          </TabsContent>

          {/* ------------------------------------------------- recibos */}
          <TabsContent value="invoicing" className="mt-4">
            <form
              className="max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-5 shadow-subtle"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate({
                  invoice_prefix: invoicing.invoice_prefix.trim() || "REC",
                  default_grace_days: Number(invoicing.default_grace_days) || 0,
                  default_late_fee:
                    invoicing.default_late_fee === "" ? 0 : invoicing.default_late_fee,
                  nsf_fee: invoicing.nsf_fee === "" ? 0 : invoicing.nsf_fee,
                });
              }}
            >
              <Field
                label={t("settings.fields.invoicePrefix")}
                htmlFor="invoice-prefix"
                hint={t("settings.fields.invoicePrefixHint")}
              >
                <Input
                  id="invoice-prefix"
                  maxLength={8}
                  className="uppercase"
                  value={invoicing.invoice_prefix}
                  onChange={(event) =>
                    setInvoicing({ ...invoicing, invoice_prefix: event.target.value.toUpperCase() })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.graceDays")} htmlFor="grace-days">
                <Input
                  id="grace-days"
                  inputMode="numeric"
                  className="numeric"
                  value={invoicing.default_grace_days}
                  onChange={(event) =>
                    setInvoicing({
                      ...invoicing,
                      default_grace_days: event.target.value.replace(/\D/g, ""),
                    })
                  }
                />
              </Field>
              <Field label={t("contracts.fields.lateFee")}>
                <MoneyInput
                  value={invoicing.default_late_fee}
                  onChange={(value) => setInvoicing({ ...invoicing, default_late_fee: value })}
                />
              </Field>
              <Field label={t("settings.fields.nsfFee")} hint={t("settings.fields.nsfFeeHint")}>
                <MoneyInput
                  value={invoicing.nsf_fee}
                  onChange={(value) => setInvoicing({ ...invoicing, nsf_fee: value })}
                />
              </Field>
              <Button type="submit" disabled={save.isPending}>
                {t("actions.save")}
              </Button>
            </form>
          </TabsContent>

          {/* ------------------------------------------ usuarios (admin) */}
          <TabsContent value="users" className="mt-4">
            <AdminOnly
              fallback={
                <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {t("settings.adminOnly")}
                </p>
              }
            >
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button onClick={() => setInviteOpen(true)}>
                    <UserPlus className="size-4" />
                    {t("settings.inviteUser")}
                  </Button>
                </div>
                <QueryState
                  isLoading={staff.isLoading}
                  error={staff.error}
                  isEmpty={(staff.data?.length ?? 0) === 0}
                  onRetry={() => void staff.refetch()}
                  skeleton={<RowsSkeleton count={3} />}
                >
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                    {staff.data?.map((profile) => (
                      <li
                        key={profile.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{profile.full_name ?? "—"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <Shield className="mr-1 inline size-3" />
                            {t(`roles.${profile.role}`)}
                          </p>
                        </div>
                        <Select
                          value={profile.role}
                          onValueChange={(value) =>
                            changeRole.mutate({ id: profile.id, role: value as Enums<"user_role"> })
                          }
                        >
                          <SelectTrigger className="w-44" aria-label={t("settings.fields.role")}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {t(`roles.${role}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </li>
                    ))}
                  </ul>
                </QueryState>
              </div>
            </AdminOnly>
          </TabsContent>

          {/* --------------------------------------------- preferencias */}
          <TabsContent value="preferences" className="mt-4">
            <section className="max-w-2xl space-y-5 rounded-lg border border-border bg-surface p-5 shadow-subtle">
              <div>
                <p className="text-sm font-medium">{t("actions.changeLanguage")}</p>
                <div className="mt-2 grid max-w-sm grid-cols-2 gap-2">
                  {(["es-MX", "en"] as const).map((language) => (
                    <button
                      key={language}
                      type="button"
                      onClick={() => setLanguage(language)}
                      aria-pressed={i18nInstance.language === language}
                      className={cn(
                        "h-10 rounded-lg border text-sm font-medium",
                        i18nInstance.language === language
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface hover:bg-muted",
                      )}
                    >
                      {language === "es-MX" ? "Español (México)" : "English"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">{t("actions.changeTheme")}</p>
                <Button variant="outline" className="mt-2" onClick={toggleTheme}>
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {t(dark ? "theme.light" : "theme.dark")}
                </Button>
              </div>
            </section>
          </TabsContent>
        </Tabs>

        <FormDialog
          open={inviteOpen}
          onOpenChange={(next) => {
            setInviteOpen(next);
            if (!next) setError(null);
          }}
          title={t("settings.inviteUser")}
          description={t("settings.inviteDescription")}
          error={error}
          pending={sendInvite.isPending}
          submitLabel={t("settings.sendInvite")}
          onSubmit={() => {
            setError(null);
            if (!/^\S+@\S+\.\S+$/.test(invite.email.trim()))
              return setError(t("tenants.errors.emailInvalid"));
            if (!invite.full_name.trim()) return setError(t("tenants.errors.nameRequired"));
            sendInvite.mutate(undefined);
          }}
        >
          <Field label={t("tenants.fields.fullName")} htmlFor="invite-name">
            <Input
              id="invite-name"
              value={invite.full_name}
              onChange={(event) => setInvite({ ...invite, full_name: event.target.value })}
            />
          </Field>
          <Field label={t("tenants.fields.email")} htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })}
            />
          </Field>
          <Field label={t("settings.fields.role")}>
            <Select
              value={invite.role}
              onValueChange={(value) => setInvite({ ...invite, role: value as Enums<"user_role"> })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FormDialog>
      </QueryState>
    </div>
  );
}
