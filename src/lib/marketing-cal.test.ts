import { expect, test } from "bun:test";
import { BOOKING_URL, calLinkFor } from "@/lib/marketing";

test("cal.com URLs become popup links; anything else stays a plain link", () => {
  expect(calLinkFor(BOOKING_URL)).toBe("abdullah-mahi-unbjhx/rentio-partner-meeting");
  expect(calLinkFor("https://cal.com/team/event/?month=2026-11")).toBe("team/event");
  expect(calLinkFor("https://calendly.com/x/y")).toBeNull();
  expect(calLinkFor("https://evil.example/https://cal.com/x")).toBeNull();
});
