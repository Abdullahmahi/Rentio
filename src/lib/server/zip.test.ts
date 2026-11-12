import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { crc32, zipStore } from "@/lib/server/zip";

test("crc32 matches the standard check value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});

test("unzip reads the archive back byte for byte", () => {
  const dir = mkdtempSync(join(tmpdir(), "rentio-zip-"));
  const files = [
    { name: "properties.csv", data: "id,name\r\n1,Café Ñandú\r\n" },
    { name: "empty.csv", data: "" },
  ];
  writeFileSync(join(dir, "out.zip"), zipStore(files));
  // `unzip -t` verifies every CRC (ships with macOS; the Docker build runs no tests).
  expect(execFileSync("unzip", ["-t", join(dir, "out.zip")]).toString()).toContain("No errors");
  execFileSync("unzip", ["-o", "-q", join(dir, "out.zip"), "-d", join(dir, "x")]);
  expect(readFileSync(join(dir, "x", "properties.csv"), "utf8")).toBe(files[0]!.data);
  expect(readFileSync(join(dir, "x", "empty.csv"), "utf8")).toBe("");
});
