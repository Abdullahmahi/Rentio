import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { RentioMark } from "@/components/rentio/rentio-mark";
import { BookingLink } from "@/components/marketing/booking-link";
import { LanguageToggle } from "@/components/marketing/language-toggle";
import { cn } from "@/lib/utils";

/**
 * Home-page anchors, written as `/#id` so they also work from /privacy,
 * /terms and /contact. "Pricing" is the offer card; there is no pricing page.
 */
const SECTIONS = [
  { id: "what-it-does", key: "nav.whatItDoes" },
  { id: "compliance", key: "nav.compliance" },
  { id: "ai", key: "nav.ai" },
  { id: "offer", key: "nav.pricing" },
  { id: "faq", key: "nav.faq" },
] as const;

export function Navbar() {
  const { t } = useTranslation("marketing");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 h-16 w-full transition-colors duration-200",
        scrolled ? "border-b border-border bg-background/80 backdrop-blur-sm" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label={t("nav.home")} className="rounded-lg">
          <RentioMark subtitle={null} />
        </Link>

        <nav className="hidden lg:block">
          <ul className="flex items-center gap-8">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`/#${section.id}`}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t(section.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <LanguageToggle className="hidden sm:inline-flex" />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link to="/sign-in">{t("nav.signIn")}</Link>
          </Button>
          <BookingLink className="hidden sm:inline-flex">{t("nav.book")}</BookingLink>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="lg:hidden"
                aria-label={t("nav.openMenu")}
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full pt-12 sm:w-[320px]">
              <SheetHeader className="mb-8">
                <SheetTitle className="text-left">{t("nav.menu")}</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4">
                {SECTIONS.map((section) => (
                  <a
                    key={section.id}
                    href={`/#${section.id}`}
                    className="flex h-12 items-center rounded-lg px-2 text-base font-medium transition-colors hover:bg-muted"
                  >
                    {t(section.key)}
                  </a>
                ))}
                <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                  <LanguageToggle className="h-12 w-full justify-start px-2" />
                  <Button asChild variant="outline" className="h-12 w-full">
                    <Link to="/sign-in">{t("nav.signIn")}</Link>
                  </Button>
                  <BookingLink className="h-12 w-full">{t("nav.book")}</BookingLink>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
