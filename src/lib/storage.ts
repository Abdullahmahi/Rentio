import { supabase } from "@/lib/supabase";

export type Bucket = "contracts" | "tenant-docs" | "payment-receipts" | "work-order-photos" | "company";

/** Buckets are private. Paths follow <owner-id>/<file>, which is what the
 *  storage RLS policies scope tenant access on — keep the prefix. */
export async function uploadFile(bucket: Bucket, ownerId: string, file: File) {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${ownerId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

/** Private buckets have no public URL — always mint a short-lived signed one. */
export async function signedUrl(bucket: Bucket, path: string, expiresInSeconds = 60 * 10) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function openSigned(bucket: Bucket, path: string) {
  window.open(await signedUrl(bucket, path), "_blank", "noopener,noreferrer");
}

export async function removeFile(bucket: Bucket, path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
