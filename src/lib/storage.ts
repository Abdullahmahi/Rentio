import { apiFetch } from "@/lib/db";

export type Bucket =
  "contracts" | "tenant-docs" | "payment-receipts" | "work-order-photos" | "company";

/** Calls /api/storage/<action>; the server repeats every access check. */
async function storage<T>(action: string, init: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/storage/${action}`, { method: "POST", ...init });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(data?.error ?? `storage ${action} failed (${response.status})`);
  return data as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Files are private. Paths follow <owner-id>/<file>, which is what the
 *  server's access check scopes tenant access on — keep the prefix. */
export async function uploadFile(bucket: Bucket, ownerId: string, file: File) {
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const form = new FormData();
  form.set("bucket", bucket);
  form.set("path", `${ownerId}/${Date.now()}-${safeName}`);
  form.set("file", file);
  const { path } = await storage<{ path: string }>("upload", { body: form });
  return path;
}

/**
 * Signs a batch in one request. Forty kanban cards one at a time is forty
 * round trips; this is one. Missing or forbidden paths come back absent
 * rather than throwing — a card whose photo went missing should still render.
 */
export async function signedUrls(bucket: Bucket, paths: string[], expiresInSeconds = 60 * 10) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map<string, string>();
  const { urls } = await storage<{ urls: Record<string, string> }>(
    "sign",
    json({ bucket, paths: unique, expiresIn: expiresInSeconds }),
  );
  return new Map(Object.entries(urls));
}

/** Private files have no public URL — always mint a short-lived signed one. */
export async function signedUrl(bucket: Bucket, path: string, expiresInSeconds = 60 * 10) {
  const url = (await signedUrls(bucket, [path], expiresInSeconds)).get(path);
  if (!url) throw new Error("file not found");
  return url;
}

export async function openSigned(bucket: Bucket, path: string) {
  window.open(await signedUrl(bucket, path), "_blank", "noopener,noreferrer");
}

export async function removeFile(bucket: Bucket, path: string) {
  await storage("remove", json({ bucket, path }));
}
