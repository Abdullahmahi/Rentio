/**
 * E-sign helpers shared by the staff screens, the signer page and the
 * server. Pure: no DOM, no node, no database.
 */
import { APP_TIMEZONE } from "@/lib/format";

/** A rectangle in PDF user space (points, origin at the page's lower-left). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Default signature spot: wide enough for a name, one line tall. */
export const SPOT_SIZE = { w: 200, h: 48 } as const;

/** How long a signing link works. "The link works for 14 days." */
export const LINK_DAYS = 14;

/** Bumped whenever the consent wording in the locale files changes. */
export const CONSENT_VERSION = "esign-consent-v1";

/**
 * The spot a click drops: centred on the click, then pushed inside the page
 * so no part of the signature lands off the paper.
 */
export function placeBox(
  center: { x: number; y: number },
  bounds: Box,
  size: { w: number; h: number } = SPOT_SIZE,
): Box {
  const w = Math.min(size.w, bounds.w);
  const h = Math.min(size.h, bounds.h);
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    x: round(clamp(center.x - w / 2, bounds.x, bounds.x + bounds.w - w)),
    y: round(clamp(center.y - h / 2, bounds.y, bounds.y + bounds.h - h)),
    w,
    h,
  };
}

/** The server repeats this: a spot must sit entirely on its page. */
export function boxInside(box: Box, bounds: Box, tolerance = 0.5) {
  return (
    [box.x, box.y, box.w, box.h].every(Number.isFinite) &&
    box.w > 0 &&
    box.h > 0 &&
    box.x >= bounds.x - tolerance &&
    box.y >= bounds.y - tolerance &&
    box.x + box.w <= bounds.x + bounds.w + tolerance &&
    box.y + box.h <= bounds.y + bounds.h + tolerance
  );
}

/** Fits a w×h image inside a box, centred, keeping its aspect ratio. */
export function fitInside(box: Box, w: number, h: number): Box {
  const scale = Math.min(box.w / w, box.h / h);
  const fw = w * scale;
  const fh = h * scale;
  return { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
}

export type AgreementStatus = "sent" | "viewed" | "partly" | "signed" | "expired" | "voided";

/** What S2 shows for one agreement. */
export function agreementStatus(
  request: { status: string; expires_at: string },
  signers: { viewed_at: string | null; signed_at: string | null }[],
  now = new Date(),
): AgreementStatus {
  if (request.status === "completed") return "signed";
  if (request.status === "voided") return "voided";
  if (new Date(request.expires_at) < now) return "expired";
  if (signers.some((signer) => signer.signed_at)) return "partly";
  if (signers.some((signer) => signer.viewed_at)) return "viewed";
  return "sent";
}

export const STATUS_VARIANT: Record<
  AgreementStatus,
  "success" | "warning" | "danger" | "info" | "neutral"
> = {
  sent: "info",
  viewed: "info",
  partly: "warning",
  signed: "success",
  expired: "danger",
  voided: "neutral",
};

/** "Nov 12, 3:41 PM", in El Paso time, in the reader's language. */
export function formatStamp(value: string, language: string) {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-MX", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** A signer's link, from the token the server minted. */
export const signLink = (siteUrl: string, token: string) => `${siteUrl}/sign/${token}`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string) => EMAIL.test(value.trim());
