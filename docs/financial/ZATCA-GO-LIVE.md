# ZATCA go-live runbook (EliteDev)

What the application does, what the business must do, and in which order.
Never paste OTPs, CSID secrets, private keys or CRON_SECRET into chat, tickets
or source control. They are entered in the app or in Vercel's encrypted
environment settings only.

## 0. Current state

| Item | State |
|---|---|
| Database migrations up to `20261029090000_zatca_automation` | Applied to staging and production |
| Sandbox (developer portal) onboarding + 6 compliance checks | Passed live (synthetic taxpayer) |
| Simulation gateway | Supported (`ZATCA_MODE=simulation`) |
| Production gateway (`/e-invoicing/core`) | **Closed in code.** Opening it is a separate, owner-approved change after a successful simulation run (step 5) |
| Automatic submission | At finalization of every sales invoice/credit/debit note, plus a daily backstop (`/api/cron/zatca`, 00:00 Riyadh) |
| App deployment | Vercel native Git deploys are disabled (`vercel.json`), so a person with access to team `elitesaasc-5643` must deploy (step 2) |

## 1. Business data (owner/accountant, in the app)

1. **Settings → Company**: legal name exactly as registered with ZATCA, VAT
   number (15 digits, starts and ends with 3), CR number and the full
   **National Address**: building number (4 digits), street, district, city,
   postal code (5 digits) and additional number (from Saudi Post / SPL).
2. **Customers that are VAT-registered businesses (B2B)**: VAT number and full
   National Address. Without a valid buyer VAT number an invoice is treated as
   simplified (B2C) and is *reported*, not *cleared*.
3. The ZATCA tab's **ZATCA readiness → Company tax profile** must show
   *Complete*.

## 2. Deploy the merged `master` (needs Vercel access)

Vercel project: `elitesaasc-5643/elite-dashboard`. In **Settings → Environment
Variables (Production)** add:

| Variable | Value |
|---|---|
| `CRON_SECRET` | a random value of at least 32 characters (`openssl rand -hex 32`). Vercel Cron sends it automatically as `Authorization: Bearer …` |
| `ZATCA_MODE` | `simulation` |
| `ZATCA_API_BASE_URL` | `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation` |

Do **not** set `ZATCA_PRODUCTION_ENABLED` yet. Then deploy the exact merge
commit, either from the dashboard (**Deployments → Create Deployment →
branch `master`**) or from a terminal:

```bash
npm i -g vercel
vercel login                 # account that belongs to team elitesaasc-5643
vercel link --project elite-dashboard --scope elitesaasc-5643
git checkout master && git pull
vercel deploy --prod
```

Check `https://<production-domain>/api/health` returns `healthy`, then sign in.
In Accounting → ZATCA, the banner must say that the non-production gateway
is enabled (simulation).

The Vercel daily cron is created automatically from `vercel.json` on deploy.
On a Pro plan you may change the schedule to `0 */6 * * *` for faster retries.

## 3. Simulation onboarding (owner, ~10 minutes)

1. Sign in to the **Fatoora portal** (`https://fatoora.zatca.gov.sa`) with the
   taxpayer's ZATCA credentials, switch to the **Simulation** environment and
   choose **Onboard new solution unit/device**. Generate an OTP (valid
   about 1 hour).
2. In the app, as a user with *accounting: approve*: **Accounting → ZATCA →
   Onboard**, environment *simulation*, enter the 6-digit OTP and press
   **Start onboarding**.
3. The app generates the EGS key and CSR, obtains the compliance CSID, runs the
   six compliance documents (standard/simplified invoice, credit and debit
   note) and only then requests the production CSID of the simulation
   environment. All six must show *cleared* (standard) or *reported*
   (simplified). On success the EGS stream is registered, its time becomes the
   **go-live cutoff** (earlier documents are never sent) and the onboarding
   user becomes the **ZATCA operator** for automatic submission.
4. If a check fails, the readiness panel and the dialog show the error codes.
   Fix the data (usually the National Address or VAT number) and repeat with a
   new OTP.

## 4. Simulation run with real documents (1–2 weeks recommended)

- Finalize real invoices and notes as usual. Each is prepared (ICV/PIH chain,
  Riyadh-local issue time = finalization time), signed and cleared/reported
  in simulation immediately. Failed submissions are retried daily.
- Watch **ZATCA readiness → Documents awaiting submission**: it must stay at
  0 overdue. Review rejections in the transmission log (warnings are allowed,
  errors are not).
- Cross-check a sample in the Fatoora simulation portal (invoice counts and
  totals).
- Printed invoice PDFs carry the stamped QR from the accepted document,
  labelled with the simulation environment.

## 5. Production (requires explicit owner approval)

Production stays closed in code until the owner approves the simulation
results. When approved, the change does the following:

1. Accept `ZATCA_MODE=production` only together with
   `ZATCA_PRODUCTION_ENABLED=true` and exactly
   `https://gw-fatoora.zatca.gov.sa/e-invoicing/core`.
2. Allow production onboarding only for a tenant that has completed simulation
   onboarding with all checks passed.
3. Widen the `environment` checks of the issuance/submission tables to include
   `production` (migration).

After deploying that change: set the three variables, generate a
**production** OTP in the Fatoora portal (**Onboard new solution
unit/device**), onboard in the app, and confirm the first cleared/reported
document in the Fatoora portal. The production registration time is the legal
go-live cutoff.

## 6. Operations

- **Certificate expiry**: the readiness panel warns at 30 days or less.
  Renew by onboarding again with a new OTP. The same EGS serial and ICV/PIH
  chain are reused.
- **Operator leaves or loses the role**: automatic submission stops (the
  grant is re-checked on every run). Any accountant with *approve* re-onboards
  to become the operator.
- **Emergency stop**: remove `ZATCA_MODE`/`ZATCA_API_BASE_URL` (or set
  `ZATCA_MODE=mock`) and redeploy. Issued documents and evidence are kept and
  submission resumes when the variables are restored.
- B2C (simplified) documents must be reported within 24 hours. B2B
  (standard) invoices must be cleared before they are shared with the buyer.
  Always send the PDF only after its status is *cleared*.
