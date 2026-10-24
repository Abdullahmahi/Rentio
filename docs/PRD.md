# PRD: Rentio

| | |
|---|---|
| **Version** | 2.0 |
| **Date** | 2026-10-21 |
| **Status** | Current. Replaces `../PRD.md` (v1.0, 2026-09-19), which was written for Mexico and is out of date. |
| **Market** | El Paso, Texas. Every client is in Texas today. |
| **Next phase** | Multi-tenant platform with Stripe Connect. Plan: [`superpowers/specs/2026-10-10-multi-tenant-platform-design.md`](superpowers/specs/2026-10-10-multi-tenant-platform-design.md) |

---

## 1. What it is

Rentio is rental property management for small and mid-size landlords.
It has two portals backed by one database:

- **Staff portal** (`/app`) for the owner and property managers. It covers properties, units, tenants, leases, monthly receipts, the payment ledger, expenses, income reports and maintenance, and it enforces Texas Property Code deadlines.
- **Tenant portal** (`/portal`) for residents. Tenants see their balance, pay or report a payment, download receipts and the lease, and file maintenance requests.

**Positioning:** "the system your tenants can actually read." The pitch is
the tenant experience (bilingual, mobile-first, clear balances), not the
landlord's admin time. The public landing page at `/` has one call to action,
*Book a meeting*.

**v1 is a system of record.** It tracks money but does not move it. Tenants
pay outside the app (ACH, Zelle, check, money order, cash), report it in the
portal, and staff confirm it. Online payment arrives in the next phase.

## 2. Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Replace spreadsheets and texting as the source of truth for units, leases and rent | All units and active leases loaded via CSV import within 2 weeks of a client going live |
| G2 | Make the monthly rent cycle a short, repeatable task | One session to generate, review and send every receipt for the month; < 30 min |
| G3 | Never let the client break Texas law by accident | Zero unlawful late fees, deposit returns or repair delays possible through the UI or the database |
| G4 | End the "I already paid, I sent you the screenshot" loop | > 70% of tenants activated in the portal within 90 days; > 60% of maintenance requests arrive through it |
| G5 | Real-time delinquency picture | Dashboard overdue amount and count accurate to the day |
| G6 | Onboard a second property management company with zero client-specific code | Next phase: org created, staff invited and import done the same day |

## 3. Users and roles

| Role | Who | Can |
|---|---|---|
| **Admin** | Owner / director | Everything: financials, users, settings, void payments, delete, change rent |
| **Manager** | Day-to-day staff | Properties, units, tenants, leases, receipts, record and confirm payments, expenses, maintenance, reports. **Cannot** void payments, delete records, change a lease's rent, or manage users |
| **Tenant** | Resident | Their own lease, balance, receipts, payment reports, maintenance requests and contact details. Nothing else |
| **Platform** *(next phase)* | Our team | Create organizations, set modules, domain and fees. Sees no client data |

**Hard rule:** a tenant can never read another tenant's data, and (next
phase) one organization can never read another's. The database enforces
this with row-level security. Hiding it in the UI is not enough.

## 4. Scope today

### 4.1 Staff portal: in the nav

The owner asked for exactly these, and the nav shows nothing else:

| Area | Must do |
|---|---|
| **Dashboard** | KPIs (occupancy, collected vs expected, overdue, open work orders, expiring leases) plus alert strips: payments to confirm, access requests, deposits due, health-and-safety repairs, turnover |
| **Properties** | US address, `units_in_structure` (drives the late-fee cap), property detail |
| **Units** | Number, beds/baths, sq ft, base rent, status derived from the lease |
| **Tenants** | Contact details, documents, invite to portal, balance and history |
| **Leases** | Wizard with primary, co-tenant and guarantor; rent, due day, grace, late fee (fixed or %), deposit; signed PDF upload; renew and terminate; deposit settlement; notice to vacate; turnover checklist |
| **Payments** | Record a payment, the confirm/reject queue for tenant reports, admin-only void with a reason, CSV export. **Receipts** opens from here: generate the month, review, send, apply late fee |
| **Expenses** | One row per unit, rolled up by property. Staff only |
| **Reports** | Rent income (confirmed payments) vs expenses over 12 months, filtered by property and unit. *(No CSV export since the scope trim; v1 required one. Owner to confirm.)* |
| **Maintenance** | Two columns, **New** and **Completed**, each card showing the §92.056 repair clock. Reopening an order restarts the clock |

### 4.2 Staff portal: built but hidden

These routes are deployed but left out of the nav. Reach them by URL; Settings
opens from the user menu. Do not delete them, and do not add them back to the
nav without the owner's say-so.

| Route | How it's reached |
|---|---|
| Receipts `/app/receipts` | Button on Payments, ⌘K, row clicks |
| Settings `/app/settings` | User menu |
| Access requests `/app/requests` | Dashboard strip, only while some are pending |
| Parking · Services (utility charges, no longer billed on receipts) · CSV import | URL only |
| `/signup` (tenant self-enroll) | Nothing links to it |

### 4.3 Tenant portal

Mobile-first, Spanish by default, built for one thumb on a poor connection.

| Tab | Must do |
|---|---|
| **Payments** (home) | Balance owed now and its due date, or "up to date"; payment instructions with copy buttons; "Report a payment" (amount, date, method, reference, receipt photo), shown as pending until staff act; links to receipts (§92.011) and the lease (§92.024). "Pay online" is visible but disabled until the next phase |
| **Service requests** | New request (category, priority, description, photos); list with status and the staff notes the tenant is allowed to see |
| **Profile** (header) | Phone, email, emergency contact, password, language |

### 4.4 Front door

- `/` is the marketing page. The only CTA is *Book a meeting* (Cal.com link). The page stores no lead data.
- `/sign-in` (`/login` redirects here for old links) · `/activate` (invited users set a password; expired links can be resent) · `/request-access` (anonymous; identical response for every input) · forgot and reset password.
- Social sign-in appears only for providers enabled in Supabase. None are enabled today.

### 4.5 Texas compliance (non-negotiable)

This is a build specification, not legal advice. The client's attorney
reviews the notice and disposition templates before real use.

| Statute | Requirement |
|---|---|
| §92.019 | No late fee until rent is unpaid at the end of the 2nd full day after the due date. The fee is capped at 12% of monthly rent for a structure of ≤4 units, 10% otherwise; if the size is unknown, 10% applies |
| §92.103–.109 | Deposit returned within 30 days of receiving the forwarding address, with itemized deductions in the tenant's language |
| §92.052, §92.056 | Repairs: written notice starts a 7-day "presumed reasonable" clock; portal requests count as written notice |
| §24.005 | Notice to vacate generated in the tenant's language |
| §92.156 | Rekey within 7 days of a new tenant taking possession (turnover checklist) |
| §92.011, §92.024 | Tenant can always get a rent receipt and a copy of the lease |

### 4.6 Language, money, time

- English and Spanish (es-MX) everywhere. Staff default to English, tenants to Spanish. The choice persists per user.
- USD, `$1,234.50`, tabular numerals. Dates `mm/dd/yyyy`.
- **Timezone is America/Denver (Mountain).** El Paso is the only major Texas city on Mountain Time.

## 5. Non-goals

These are out of scope for v1 and the next phase:

- Tenant screening, listings, applications, marketing of vacant units
- E-signature (the signed PDF is uploaded instead)
- Accounting integrations (CSV export only)
- Native mobile apps (the web app is mobile-first)
- Convenience fees charged to tenants; Zelle or PayPal online; partial refunds or disputes in-app (handled in the client's Stripe dashboard)
- Self-serve signup and in-app billing of our clients (we invoice outside the product)
- A platform-admin view into client data
- WhatsApp or voice intake (the `work_orders.source` enum keeps a `whatsapp` value so it can be added later)
- Non-Texas compliance (becomes a module when the first non-Texas client signs)

## 6. Next phase: multi-tenant platform

Approved in conversation 2026-10-10, awaiting written review. The spec is the
source of truth; this is the product summary.

- **One platform, many organizations.** Our team creates each organization; `org_id` goes on every row and RLS isolates organizations.
- **Branding by configuration only:** logo, primary and accent colour (contrast ≥ 4.5:1 enforced), modules on or off, portal at `<slug>.<platform-domain>` or a custom domain. No client-specific code, ever.
- **Online rent via Stripe Connect Express:** card, ACH, Cash App Pay in one Checkout. The organization is merchant of record and the landlord absorbs fees. The platform fee is wired but set to 0.
- **`/platform` page** for our team: create orgs, toggle modules, set the domain, invite the first admin.
- **El Paso becomes org one** with no visible change for its users.

Rollout runs in five independently shippable phases (spec §11). Each phase
ends with `docs/audit.md`.

## 7. Success metrics

| Metric | Target (90 days after go-live) |
|---|---|
| Time to generate and send the month's receipts | < 30 min |
| Tenants activated in the portal | > 70% |
| Maintenance requests via portal | > 60% |
| Repair orders resolved inside the 7-day clock | > 90% |
| Deposits returned inside 30 days | 100% |
| Late fees applied before the lawful date | 0 (the database refuses them) |
| *(next phase)* Rent paid online | > 50% of payments |

## 8. Risks and open questions

| Risk / question | Impact | Mitigation / owner |
|---|---|---|
| `RESEND_FROM` not on a verified domain; `SITE_URL` still `localhost` | Real tenants get no email, or an invite link to localhost | Verify domain, set both secrets before any real tenant (SETUP.md) |
| Demo passwords documented in SETUP.md in a **public** repo | Anyone can sign in to the live project as admin | Rotate before anyone outside the team sees it |
| Notice and disposition templates not attorney-reviewed | Legal exposure | Client's attorney, before first real use |
| An email belongs to one account platform-wide (next phase) | A tenant renting from two clients needs two emails | Accepted in the spec; revisit if it happens |
| Who owns the slug and custom domain choice per client? | Onboarding friction | Our team, per spec §12 runbook |
