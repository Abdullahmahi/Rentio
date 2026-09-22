/**
 * The only lead capture on the public site.
 *
 * Cal.com collects the name, the email and the time. Nothing is stored here:
 * no table, no RLS policy, no notification mail. Every call to action on every
 * marketing section imports this one constant — if you find the literal URL
 * anywhere else, that is the bug.
 */
export const BOOKING_URL = "https://cal.com/abdullah-mahi-unbjhx/rentio-partner-meeting";

/** Applied to every outbound link, so none of them can silently eat the page. */
export const EXTERNAL_LINK = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
