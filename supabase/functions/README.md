# Edge functions

| Function | Who may call it | What it does |
| --- | --- | --- |
| `generate-invoice-pdf` | any authenticated user | Renders a recibo PDF and returns a signed URL. The invoice is read through the **caller's** client, so RLS decides visibility — a tenant can only ever render their own receipt. Only the storage upload uses the service role. |
| `send-invoice-email` | staff | Emails the recibo with the PDF attached. Calls `generate-invoice-pdf` rather than re-rendering, so the attachment and the download can't drift apart. |
| `send-tenant-invite` | staff | Creates the auth user, links `profiles.tenant_id`, emails a Spanish set-password link. Falls back to a recovery link if the address is already registered. |
| `send-staff-invite` | admin only | Same, for an admin or property manager. |

## Deploy

```sh
supabase functions deploy generate-invoice-pdf send-invoice-email send-tenant-invite send-staff-invite
```

## Secrets

```sh
supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM="Rentio <no-reply@tu-dominio.mx>" SITE_URL=https://tu-app.com
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. Without `RESEND_API_KEY` the email functions return a clear
error rather than silently doing nothing; PDF generation does not need it.
