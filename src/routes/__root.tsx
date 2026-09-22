import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import "@fontsource-variable/inter";
// Real italic cuts, not synthesised obliques — the marketing headings set one
// italic word per h2 and a faux-italic Inter is visibly wrong at display size.
import "@fontsource-variable/inter/wght-italic.css";
import appCss from "../styles.css?url";
import { AuthProvider } from "../lib/auth";
import { INTERNAL_DEFAULT_LANGUAGE, PORTAL_DEFAULT_LANGUAGE } from "../lib/i18n";
import { Toaster } from "../components/ui/sonner";
import "../lib/i18n";

function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("empty.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("empty.description")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("nav.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("empty.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("empty.description")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("actions.confirm")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("nav.home")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Rentio" },
      // Routes override the title and description through their own head().
      // These are the fallbacks, and the og:* tags below are what a link
      // pasted into email or WhatsApp actually unfurls with - the previous
      // description was the literal string "Rentio" and there was no image.
      {
        name: "description",
        content:
          "Bilingual property management software for Texas landlords - a tenant portal in English and Spanish, every request tracked whichever way it arrives, and Texas compliance built in.",
      },
      { name: "author", content: "Rentio" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Rentio" },
      { property: "og:title", content: "Property management your tenants can read" },
      {
        property: "og:description",
        content:
          "A bilingual tenant portal, every request tracked whichever way it arrives, and Texas compliance built in.",
      },
      { property: "og:image", content: "/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "The Rentio tenant portal shown side by side in English and Spanish",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Property management your tenants can read" },
      {
        name: "twitter:description",
        content:
          "A bilingual tenant portal, every request tracked whichever way it arrives, and Texas compliance built in.",
      },
      { name: "twitter:image", content: "/og.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // The shell renders on the server, where there is no profile and no
  // localStorage, so the honest first-paint value is the per-portal default:
  // tenants land in Spanish, staff in English. Once the client resolves the
  // user's actual preference, `useLanguagePreference` updates the attribute.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const lang = pathname.startsWith("/portal") ? PORTAL_DEFAULT_LANGUAGE : INTERNAL_DEFAULT_LANGUAGE;

  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
