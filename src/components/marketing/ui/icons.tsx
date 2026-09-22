import type { SVGProps } from "react";

/**
 * The two orbit markers from Vetra's `components/global/icons.tsx`. Only these
 * two are ported — the rest of that file is social logos for accounts that do
 * not exist, and the footer ships without them.
 */
export const OrbitRing = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M42 21C42 32.598 32.598 42 21 42C9.40202 42 0 32.598 0 21C0 9.40202 9.40202 0 21 0C32.598 0 42 9.40202 42 21ZM1.00838 21C1.00838 32.0411 9.95893 40.9916 21 40.9916C32.0411 40.9916 40.9916 32.0411 40.9916 21C40.9916 9.95893 32.0411 1.00838 21 1.00838C9.95893 1.00838 1.00838 9.95893 1.00838 21Z"
      fill="currentColor"
    />
    <circle cx="21" cy="21" r="10" fill="currentColor" />
  </svg>
);

export const OrbitDot = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <circle cx="10" cy="10" r="10" fill="currentColor" />
  </svg>
);
