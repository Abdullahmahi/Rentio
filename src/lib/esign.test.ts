import { expect, test } from "bun:test";
import {
  agreementStatus,
  boxInside,
  fitInside,
  isEmail,
  parseSigners,
  placeBox,
} from "@/lib/esign";

const letter = { x: 0, y: 0, w: 612, h: 792 };

test("a click drops a spot centred on it", () => {
  expect(placeBox({ x: 306, y: 400 }, letter, { w: 200, h: 48 })).toEqual({
    x: 206,
    y: 376,
    w: 200,
    h: 48,
  });
});

test("a click near the edge keeps the spot on the page", () => {
  const box = placeBox({ x: 600, y: 5 }, letter, { w: 200, h: 48 });
  expect(box).toEqual({ x: 412, y: 0, w: 200, h: 48 });
  expect(boxInside(box, letter)).toBe(true);
});

test("a page with a shifted crop box clamps to that box", () => {
  const cropped = { x: 36, y: 36, w: 540, h: 720 };
  const box = placeBox({ x: 0, y: 0 }, cropped);
  expect(box.x).toBe(36);
  expect(box.y).toBe(36);
  expect(boxInside(box, cropped)).toBe(true);
});

test("boxInside refuses spots off the page or malformed", () => {
  expect(boxInside({ x: 500, y: 10, w: 200, h: 48 }, letter)).toBe(false);
  expect(boxInside({ x: -5, y: 10, w: 200, h: 48 }, letter)).toBe(false);
  expect(boxInside({ x: NaN, y: 10, w: 200, h: 48 }, letter)).toBe(false);
  expect(boxInside({ x: 10, y: 10, w: 0, h: 48 }, letter)).toBe(false);
});

test("fitInside keeps the drawing's proportions, centred", () => {
  expect(fitInside({ x: 0, y: 0, w: 200, h: 50 }, 400, 50)).toEqual({
    x: 0,
    y: 12.5,
    w: 200,
    h: 25,
  });
  expect(fitInside({ x: 10, y: 0, w: 200, h: 50 }, 100, 100)).toEqual({
    x: 85,
    y: 0,
    w: 50,
    h: 50,
  });
});

test("agreement status follows the signers", () => {
  const open = { status: "sent", expires_at: "2099-01-01T00:00:00Z" };
  const none = { viewed_at: null, signed_at: null };
  const viewed = { viewed_at: "2026-11-11T10:00:00Z", signed_at: null };
  const signed = { viewed_at: "2026-11-11T10:00:00Z", signed_at: "2026-11-12T10:00:00Z" };
  expect(agreementStatus(open, [none, none])).toBe("sent");
  expect(agreementStatus(open, [viewed, none])).toBe("viewed");
  expect(agreementStatus(open, [signed, viewed])).toBe("partly");
  expect(agreementStatus({ ...open, status: "completed" }, [signed])).toBe("signed");
  expect(agreementStatus({ ...open, status: "voided" }, [none])).toBe("voided");
  expect(agreementStatus({ ...open, status: "declined" }, [signed, viewed])).toBe("declined");
  expect(agreementStatus({ status: "sent", expires_at: "2026-01-01T00:00:00Z" }, [none])).toBe(
    "expired",
  );
});

test("send validation: every signer needs a spot on a real page", () => {
  const pages = [letter, letter];
  const lease = new Set(["t1"]);
  const daniel = {
    name: "Daniel",
    email: "d@example.com",
    tenant_id: "t1",
    page: 2,
    x: 72,
    y: 100,
    w: 200,
    h: 48,
  };
  const ok = parseSigners(
    [
      daniel,
      { ...daniel, name: "Guarantor", email: "g@example.com", tenant_id: null, required: false },
    ],
    pages,
    lease,
  );
  expect("signers" in ok && ok.signers.map((s) => s.required)).toEqual([true, false]);

  const error = (signers: unknown) => {
    const result = parseSigners(signers, pages, lease);
    return "error" in result ? result.error : null;
  };
  expect(error([])).toMatch(/between 1 and 10/);
  expect(error([{ ...daniel, page: undefined }])).toMatch(/place a signature spot for Daniel/);
  expect(error([{ ...daniel, page: 3 }])).toMatch(/place a signature spot/);
  expect(error([{ ...daniel, x: 500 }])).toMatch(/place a signature spot/);
  expect(error([{ ...daniel, email: "nope" }])).toMatch(/name and an email/);
  expect(error([{ ...daniel, tenant_id: "someone-else" }])).toMatch(/not on this lease/);
  expect(error([daniel, { ...daniel, tenant_id: null, email: "D@example.com" }])).toMatch(/twice/);
});

test("isEmail", () => {
  expect(isEmail("daniel.trevino@gmail.com")).toBe(true);
  expect(isEmail(" a@b.co ")).toBe(true);
  expect(isEmail("not an email")).toBe(false);
});
