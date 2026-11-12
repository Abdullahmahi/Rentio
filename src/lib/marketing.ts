import en from "@/locales/en.json";

/**
 * The only lead capture on the public site.
 *
 * Cal.com collects the name, the email and the time. Nothing is stored here:
 * no table, no RLS policy, no notification mail. Every call to action on every
 * marketing section imports this one constant — if you find the literal URL
 * anywhere else, that is the bug.
 */
export const BOOKING_URL = "https://cal.com/abdullah-mahi-unbjhx/rentio-partner-meeting";

/**
 * The co-founders' welcome video on `/vsl`, as an embed URL (YouTube
 * `/embed/<id>` or Loom `/embed/<id>`). `null` until it is recorded; the page
 * then shows what the video covers instead of an empty player.
 * VSL_POST_BOOKING.md at the folder root has the script.
 */
export const BOOKED_VIDEO_URL: string | null = null;

/** Where a confirmed booking lands: the co-founders' video and the call prep. */
export const VSL_PATH = "/vsl";

/** "owner/event" for a cal.com URL, which is what Cal.com's popup takes; `null` for anything else. */
export function calLinkFor(url: string): string | null {
  const match = /^https:\/\/cal\.com\/([^?#]+)/.exec(url);
  return match ? match[1]!.replace(/\/$/, "") : null;
}

type CalApi = ((...args: unknown[]) => void) & {
  loaded?: boolean;
  ns?: Record<string, (...args: unknown[]) => void>;
  q?: unknown[];
};

declare global {
  interface Window {
    Cal?: CalApi;
  }
}

let calReady = false;
let calScriptLoaded = false;

/** True once embed.js has actually arrived. The stub's own `loaded` flag flips before that. */
export function calEmbedLoaded() {
  return calScriptLoaded;
}

/**
 * Loads Cal.com's embed once per page and sends the visitor to `/vsl` when a
 * booking is confirmed. The queue stub below is Cal.com's own snippet
 * (`@calcom/embed-snippet` 1.3.3), unminified: calls made before embed.js
 * arrives are queued and replayed. Booking events carry no attendee name, so
 * this path lands on `/vsl` without `?name=`.
 */
export function loadCalEmbed() {
  if (calReady || typeof window === "undefined") return;
  calReady = true;

  const queue = (api: CalApi, args: unknown) => api.q!.push(args);
  window.Cal =
    window.Cal ||
    (function cal(...args: unknown[]) {
      const api = window.Cal!;
      if (!api.loaded) {
        api.ns = {};
        api.q = api.q || [];
        const script = document.createElement("script");
        script.src = "https://app.cal.com/embed/embed.js";
        script.onload = () => {
          calScriptLoaded = true;
        };
        document.head.appendChild(script);
        api.loaded = true;
      }
      if (args[0] === "init") {
        const namespace = args[1];
        if (typeof namespace === "string") {
          const scoped: CalApi = function (...inner: unknown[]) {
            queue(scoped, inner);
          };
          scoped.q = [];
          api.ns![namespace] = api.ns![namespace] || scoped;
          queue(api.ns![namespace] as CalApi, args);
          queue(api, ["initNamespace", namespace]);
        } else {
          queue(api, args);
        }
        return;
      }
      queue(api, args);
    } as CalApi);

  window.Cal("init", "rentio", { origin: "https://app.cal.com" });
  window.Cal.ns!["rentio"]!("on", {
    action: "bookingSuccessfulV2",
    callback: () => window.location.assign(VSL_PATH),
  });
}

/** Applied to every outbound link, so none of them can silently eat the page. */
export const EXTERNAL_LINK = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

/**
 * The free Texas late-fee audit (audit.md §5.3), a 15-minute Cal.com event.
 * TODO(owner): create the 15-minute "late-fee audit" event in Cal.com (with
 * the doors + current software questions) and put its URL here. Until then it
 * falls back to the walkthrough link so the button never 404s.
 */
export const AUDIT_BOOKING_URL: string = BOOKING_URL;

/** The proof line (owner decision 2026-10-28). Never a testimonial, never a figure beyond this. */
export const CLIENT_PROOF = {
  en: "Live with 10+ property management companies in Texas",
  "es-MX": "En operación con más de 10 administradoras de propiedades en Texas",
} as const;

/** First client, for internal reference only. No quote renders until they agree in writing. */
export const FIRST_CLIENT = "Hayen Properties";

/* Pricing (owner decision 2026-10-28): flat, not per door. Every price on the page renders from these. */
/** Per month, the whole Rentio software + AI bundle. */
export const MONTHLY_PRICE = 349;
/** One-time setup: migration, training, website. */
export const SETUP_FEE = 3500;

/* Legal and contact details for /privacy, /terms, /contact and the footer.
   Empty strings are hidden, never rendered as blank rows. */
export const LEGAL_ENTITY: string = "PortfolioAI";
export const CONTACT_EMAIL: string = "support@portfolioaius.com";
export const CONTACT_PHONE: string = "";
export const CONTACT_ADDRESS: string = "";

/** Interpolation values for every price string in the marketing locale files. */
export const PRICE_VARS = {
  monthlyPrice: `$${MONTHLY_PRICE.toLocaleString("en-US")}`,
  setupFee: `$${SETUP_FEE.toLocaleString("en-US")}`,
};

/** CLIENT_PROOF in the current language. */
export function clientProof(language: string) {
  return language === "es-MX" ? CLIENT_PROOF["es-MX"] : CLIENT_PROOF.en;
}

type Tree = { [key: string]: string | Tree };

/** Leaf strings in a locale tree. */
export function countStrings(tree: Tree): number {
  return Object.values(tree).reduce<number>(
    (n, value) => n + (typeof value === "string" ? 1 : countStrings(value)),
    0,
  );
}

/** "1,101"-style count of product strings, computed from en.json at build time. */
export const SPANISH_STRINGS = countStrings(en as Tree).toLocaleString("en-US");
