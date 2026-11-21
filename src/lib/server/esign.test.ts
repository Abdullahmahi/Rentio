import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  assertOriginal,
  buildSignedPdf,
  clientIp,
  consentText,
  denverStamp,
  hashToken,
  newToken,
  originalPath,
  recordLines,
  sha256Hex,
  winAnsi,
  wrapText,
} from "@/lib/server/esign";
import { isSealed } from "@/lib/server/storage";

test("a link token is 32 random bytes and only its hash is kept", () => {
  const { token, hash } = newToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(hashToken(token)).toBe(hash);
  expect(newToken().token).not.toBe(token);
});

test("malformed tokens never reach the database", () => {
  expect(hashToken("")).toBeNull();
  expect(hashToken("short")).toBeNull();
  expect(hashToken(`${"a".repeat(42)}%`)).toBeNull();
  expect(hashToken("' or 1=1 --")).toBeNull();
});

test("client IP is the X-Forwarded-For hop our proxy appended, not one the client wrote", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/", { headers });
  const env = {};
  // The client sent "1.2.3.4"; Traefik appended the address it really saw.
  expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }), env)).toBe("203.0.113.7");
  expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }), env)).toBe("203.0.113.7");
  expect(clientIp(req({ "x-real-ip": "198.51.100.1" }), env)).toBe("198.51.100.1");
  expect(clientIp(req({}), env)).toBeNull();
});

test("CLIENT_IP_HEADER names the one header to trust", () => {
  const req = new Request("http://x/", {
    headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.2", "cf-connecting-ip": "203.0.113.9" },
  });
  expect(clientIp(req, { CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe("203.0.113.9");
  expect(clientIp(new Request("http://x/"), { CLIENT_IP_HEADER: "cf-connecting-ip" })).toBeNull();
});

test("consent text is the disclosure as shown, per language, with the company filled in", () => {
  const en = consentText("en", "Hayen");
  const es = consentText("es-MX", "Hayen");
  expect(en).toContain("Hayen");
  expect(en).not.toContain("{{company}}");
  expect(en).not.toBe(es);
  expect(sha256Hex(consentText("en", "Hayen"))).toBe(sha256Hex(en));
  expect(sha256Hex(consentText("en", "Other Co"))).not.toBe(sha256Hex(en));
});

test("a swapped or missing original is refused", () => {
  const sent = new TextEncoder().encode("%PDF rent $1,200");
  const sha = sha256Hex(sent);
  expect(assertOriginal(sent, sha)).toBe(sent);
  expect(() => assertOriginal(new TextEncoder().encode("%PDF rent $1,500"), sha)).toThrow();
  expect(() => assertOriginal(null, sha)).toThrow();
});

test("the original lives at a request-owned path that uploads refuse", () => {
  expect(originalPath("L", "R")).toBe("L/esign-R-original.pdf");
  expect(isSealed(originalPath("L", "R"))).toBe(true);
  expect(isSealed("L/signed-R.pdf")).toBe(true);
  expect(isSealed("T/signed-R.pdf")).toBe(true);
  expect(isSealed("L/lease.pdf")).toBe(false);
  expect(isSealed("L/my-esign-notes.pdf")).toBe(false);
});

test("record times are America/Denver with the zone named", () => {
  expect(denverStamp("2026-11-12T22:41:07Z")).toBe("Nov 12, 2026, 3:41:07 PM MST");
  expect(denverStamp("2026-07-04T18:00:00Z")).toBe("Jul 4, 2026, 12:00:00 PM MDT");
  expect(denverStamp(null)).toBe("-");
});

test("winAnsi keeps Spanish names and replaces what the PDF font cannot draw", () => {
  expect(winAnsi("Sofía Treviño")).toBe("Sofía Treviño");
  expect(winAnsi("“Hi” – 李")).toBe('"Hi" - ?');
});

test("wrapText wraps by width and cuts unbreakable runs", () => {
  const measure = (s: string) => s.length;
  expect(wrapText("one two three four", 9, measure)).toEqual(["one two", "three", "four"]);
  expect(wrapText("abcdefghijkl", 5, measure)).toEqual(["abcde", "fghij", "kl"]);
});

test("the record lists every signer and both fingerprints", () => {
  const text = recordLines({
    requestId: "r1",
    title: "Lease agreement",
    company: "Hayen Properties",
    sentAt: "2026-11-10T17:00:00Z",
    completedAt: "2026-11-12T22:41:07Z",
    originalSha: "a".repeat(64),
    stampedSha: "b".repeat(64),
    signers: [
      {
        name: "Daniel Treviño",
        email: "daniel@example.com",
        viewed_at: "2026-11-11T17:00:00Z",
        signed_at: "2026-11-12T22:41:07Z",
        ip: "203.0.113.7",
        user_agent: "Mozilla/5.0",
        consent_at: "2026-11-12T22:40:51Z",
        consent_version: "esign-consent-v2",
        consent_locale: "es-MX",
        consent_text_sha256: "c".repeat(64),
        signature_kind: "drawn",
      },
    ],
  })
    .map((line) => line.text)
    .join("\n");
  expect(text).toContain("Daniel Treviño");
  expect(text).toContain("daniel@example.com");
  expect(text).toContain("203.0.113.7");
  expect(text).toContain("Mozilla/5.0");
  expect(text).toContain(`Original PDF as sent: ${"a".repeat(64)}`);
  expect(text).toContain(`before this record page was appended: ${"b".repeat(64)}`);
  expect(text).toContain("Nov 12, 2026, 3:41:07 PM MST");
  expect(text).toContain("esign-consent-v2, es-MX");
  // Consent has its own time, before the signature's.
  expect(text).toContain("Nov 12, 2026, 3:40:51 PM MST");
  expect(text).toContain(`Disclosure text shown (SHA-256): ${"c".repeat(64)}`);
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("the signed PDF stamps each signature and appends the record", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const original = await doc.save();
  const signer = {
    email: "x@example.com",
    viewed_at: "2026-11-11T17:00:00Z",
    signed_at: "2026-11-12T22:41:07Z",
    ip: "203.0.113.7",
    user_agent: "UA",
    consent_at: "2026-11-12T22:41:07Z",
    consent_version: "v1",
    consent_locale: "en",
    consent_text_sha256: "c".repeat(64),
    page: 2,
    x: 72,
    y: 100,
    w: 200,
    h: 48,
  };
  const signers = [
    { ...signer, name: "Daniel", signature_kind: "drawn", signature_data: PNG },
    { ...signer, name: "Sofía", signature_kind: "typed", signature_data: PNG, y: 200 },
    // Optional and never signed: left blank, no error.
    {
      ...signer,
      name: "Guarantor",
      signed_at: null,
      signature_kind: null,
      signature_data: null,
      y: 300,
    },
  ];
  const record = {
    requestId: "r1",
    title: "Lease",
    company: "Hayen",
    sentAt: "2026-11-10T17:00:00Z",
    completedAt: "2026-11-12T22:41:07Z",
    signers,
  };
  const first = await buildSignedPdf(original, signers, record);
  expect((await PDFDocument.load(first.bytes)).getPageCount()).toBe(3);
  expect(first.signedSha).toBe(sha256Hex(first.bytes));
  expect(first.stampedSha).not.toBe(first.signedSha);
  // A retried finalisation writes the same file.
  const again = await buildSignedPdf(original, signers, record);
  expect(again.signedSha).toBe(first.signedSha);
});
