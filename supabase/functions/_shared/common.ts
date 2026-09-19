// Shared helpers for the Rentio edge functions.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * A client acting AS THE CALLER, so row level security still applies.
 * Read through this one — it is what stops a tenant generating someone
 * else's receipt.
 */
export function userClient(request: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } } },
  );
}

/** Bypasses RLS. Only for writes the caller legitimately cannot make itself,
 *  such as storing a generated PDF or creating an auth user. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
}

export async function requireStaff(client: SupabaseClient) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { user: null, isStaff: false };
  const { data } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return { user, isStaff: data?.role === "admin" || data?.role === "manager" };
}

const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export const formatMXN = (value: number) => `${MXN.format(value)} MXN`;

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Mexico_City" })
    .format(new Date(`${value}T12:00:00`));

export const formatPeriod = (value: string) => {
  const label = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "America/Mexico_City" })
    .format(new Date(`${value}T12:00:00`));
  return label.charAt(0).toLocaleUpperCase("es-MX") + label.slice(1);
};

/** Resend is optional: without a key the caller gets a clear, actionable error
 *  instead of a silent no-op. */
export async function sendEmail(options: {
  to: string; subject: string; html: string;
  attachments?: { filename: string; content: string }[];
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "Rentio <no-reply@rentio.mx>";
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [options.to], subject: options.subject, html: options.html, attachments: options.attachments }),
  });
  if (!response.ok) throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
  return await response.json();
}

/** Shared Spanish email chrome. */
export function emailLayout(title: string, body: string, companyName: string) {
  return `<!doctype html><html lang="es-MX"><body style="margin:0;background:#FAF9F7;font-family:Inter,Helvetica,Arial,sans-serif;color:#1C1A17">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E7E3DD;border-radius:10px">
        <tr><td style="padding:24px 24px 0">
          <p style="margin:0;font-size:14px;font-weight:600;color:#1B4D3E">${companyName}</p>
          <h1 style="margin:12px 0 0;font-size:20px;font-weight:600">${title}</h1>
        </td></tr>
        <tr><td style="padding:16px 24px 24px;font-size:14px;line-height:1.6">${body}</td></tr>
        <tr><td style="padding:0 24px 24px;font-size:12px;color:#6B655C;border-top:1px solid #E7E3DD;padding-top:16px">
          Este mensaje fue enviado automáticamente por ${companyName}. Si tienes dudas, responde a este correo.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
