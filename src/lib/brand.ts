/**
 * The product name, in one place.
 *
 * It was spread across ~25 route `head()` titles, the root meta, the marketing
 * footer and four locale strings. Renaming would have meant finding all of
 * them; now it means editing this line.
 *
 * Scope, deliberately: this is the **product** name — what appears in a
 * browser tab and on the public site. It is NOT the landlord's company name.
 * Anything a tenant receives — a receipt, a deposit disposition, a notice to
 * vacate — is letterheaded with `settings.company_name` ("Sun City Property
 * Management" in the demo data), because those are that landlord's documents,
 * not ours. The edge functions keep their own literal fallback for the
 * degenerate case where a landlord has not set a company name: they are a
 * separate Deno bundle and cannot import from here.
 *
 * Internal identifiers — the package name, database objects, CSS classes, file
 * names, the `RentioMark` component — are left alone. Renaming those is churn
 * with no user-visible gain.
 */
export const BRAND_NAME = "Rentio";

/**
 * The one-line positioning, for places that cannot be translated: OG and meta
 * description, email subjects, the manifest.
 *
 * In the UI itself the tagline comes from the locale files
 * (`auth.brandHeadline`, `auth.brandBody`) so it reads in the user's language —
 * a Spanish-defaulted tenant portal must not show an English tagline.
 */
export const BRAND_TAGLINE = "The system your tenants can actually read.";

/** `<title>` for a page. Keeps the separator in one place too. */
export function pageTitle(title: string) {
  return `${title} — ${BRAND_NAME}`;
}
