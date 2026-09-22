import { useTranslation } from "react-i18next";

/**
 * The brand lockup, shared by the app shell and the public navbar.
 *
 * Its own file rather than an export from `app-shell.tsx`: the marketing page
 * must not pull the authenticated shell — and with it the command palette,
 * the auth provider and the portfolio queries — into the public bundle.
 */
export function RentioMark({
  compact = false,
  subtitle,
}: {
  compact?: boolean | undefined;
  /** `null` renders the name alone — the public navbar has no subtitle. */
  subtitle?: string | null | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
        R
      </div>
      {compact ? null : (
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{t("brand.name")}</div>
          {subtitle === null ? null : (
            <div className="truncate text-xs text-muted-foreground">
              {subtitle ?? t("brand.internal")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
