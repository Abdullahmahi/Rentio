/**
 * Server-only. File storage on the server's own disk, replacing Supabase
 * Storage.
 *
 * Layout: <STORAGE_DIR>/<org_id>/<bucket>/<owner-id>/<file>. The org prefix
 * is never taken from the client, it comes from the session, so one
 * company cannot even name another's files. The paths stored in the
 * database stay `<owner-id>/<file>`, exactly as before.
 *
 * ponytail: local disk on one server. Mount STORAGE_DIR as a Coolify
 * persistent volume and include it in backups. Move to S3-compatible
 * storage (R2 / Hetzner Object Storage) before running a second app
 * instance, since a disk is not shared between them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { derivedKey, type Session } from "@/lib/server/session";

export const BUCKETS = [
  "contracts",
  "tenant-docs",
  "payment-receipts",
  "work-order-photos",
  "company",
] as const;
export type Bucket = (typeof BUCKETS)[number];

const ROOT = path.resolve(process.env["STORAGE_DIR"] ?? ".storage");
const SEGMENT = /^[\w.-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBucket(value: unknown): value is Bucket {
  return BUCKETS.includes(value as Bucket);
}

/** Refuses anything that could climb out of the bucket. */
function fileFor(orgId: string, bucket: Bucket, objectPath: string) {
  const parts = objectPath.split("/");
  const safe = parts.every((part) => SEGMENT.test(part) && part !== "." && part !== "..");
  if (!UUID.test(orgId) || !isBucket(bucket) || !safe) throw new Error("invalid storage path");
  return path.join(ROOT, orgId, bucket, ...parts);
}

export async function putObject(
  orgId: string,
  bucket: Bucket,
  objectPath: string,
  bytes: Uint8Array,
) {
  const file = fileFor(orgId, bucket, objectPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

export async function getObject(orgId: string, bucket: Bucket, objectPath: string) {
  try {
    return await readFile(fileFor(orgId, bucket, objectPath));
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw caught;
  }
}

export async function removeObject(orgId: string, bucket: Bucket, objectPath: string) {
  await rm(fileFor(orgId, bucket, objectPath), { force: true });
}

const KEY = () => derivedKey("rentio-storage-v1");
const sign = (target: string, exp: number) =>
  createHmac("sha256", KEY()).update(`${target}:${exp}`).digest("base64url");

/**
 * A short-lived link that works in an <img src> or a new tab, where no
 * Authorization header can be sent. Same contract as Supabase's signed URLs.
 */
export function signedUrl(
  orgId: string,
  bucket: Bucket,
  objectPath: string,
  expiresInSeconds = 600,
) {
  fileFor(orgId, bucket, objectPath); // validate before handing anything out
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const target = `${orgId}/${bucket}/${objectPath}`;
  return `/api/files/${target}?exp=${exp}&sig=${sign(target, exp)}`;
}

export function verifySignedUrl(target: string, exp: string | null, sig: string | null) {
  const expiry = Number(exp);
  if (!sig || !Number.isFinite(expiry) || expiry < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(target, expiry));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  csv: "text/csv",
};

/** Anything not listed (html, svg…) downloads instead of rendering. */
export function contentTypeFor(objectPath: string) {
  return TYPES[objectPath.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * The storage policies Supabase enforced on storage.objects, restated.
 * Staff: everything in their own org. Tenants: read files filed under a
 * lease, tenant record or work order of their own, plus the company logo;
 * write only proof of payment and maintenance photos. "Their own" is asked
 * of Postgres through the caller's client, so RLS answers it.
 */
export async function mayAccess(
  session: Session,
  bucket: Bucket,
  objectPath: string,
  mode: "read" | "write",
) {
  if (session.isStaff) return Boolean(session.profile.org_id);
  const owner = objectPath.split("/")[0] ?? "";
  // The company bucket also holds unit and property documents; tenants get the logo only (S-004).
  if (bucket === "company") return mode === "read" && owner === "logo";
  if (!UUID.test(owner)) return false;

  const visible = async (table: "leases" | "work_orders") => {
    const { data } = await session.db.from(table).select("id").eq("id", owner).maybeSingle();
    return Boolean(data);
  };

  if (mode === "write") {
    if (bucket === "payment-receipts") return visible("leases");
    if (bucket === "work-order-photos") return visible("work_orders");
    return false;
  }
  if (bucket === "contracts" || bucket === "payment-receipts") return visible("leases");
  if (bucket === "tenant-docs") return owner === session.profile.tenant_id;
  if (bucket === "work-order-photos") return visible("work_orders");
  return false;
}
