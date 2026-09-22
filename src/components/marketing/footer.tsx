import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { BookingLink } from "@/components/marketing/booking-link";

/**
 * Vetra's footer carries social icons and a newsletter form. Both are cut:
 * there are no social accounts to link, and this site collects nothing.
 */
export function Footer() {
  const { t } = useTranslation("marketing");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[minmax(0,2fr)_1fr_1fr]">
        <div className="min-w-0">
          <RentioMark subtitle={t("footer.tagline")} />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">{t("footer.disclaimer")}</p>
        </div>

        <nav aria-labelledby="footer-product">
          <h2
            id="footer-product"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t("footer.productHeading")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href="#what-it-does"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("nav.whatItDoes")}
              </a>
            </li>
            <li>
              <a
                href="#bilingual"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("nav.bilingual")}
              </a>
            </li>
            <li>
              <a
                href="#compliance"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("nav.compliance")}
              </a>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-company">
          <h2
            id="footer-company"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t("footer.companyHeading")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                to="/sign-in"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("footer.signIn")}
              </Link>
            </li>
          </ul>
          <BookingLink variant="outline" className="mt-4 w-full">
            {t("footer.book")}
          </BookingLink>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span className="numeric">
            &copy; {year} Rentio. {t("footer.rights")}
          </span>
        </div>
      </div>
    </footer>
  );
}
