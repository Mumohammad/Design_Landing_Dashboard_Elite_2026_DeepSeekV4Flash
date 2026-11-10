# Online card payments (Moyasar)

Customers pay Elite subscription invoices from **Settings → Billing & subscription**
with mada, Visa/Mastercard or Apple Pay through Moyasar's hosted checkout
(PCI-DSS handled by Moyasar; no card data touches Elite).

## Flow
1. Platform admin issues an invoice (Platform admin → Billing → New invoice).
2. Company owner/admin opens Settings → Billing → **Pay by card**.
3. Server creates a Moyasar invoice (amount in halalas, metadata = attempt/invoice/tenant ids,
   1-hour expiry) and redirects to the checkout URL. A recent open checkout is reused.
4. Settlement happens when any of these arrives — all re-read the invoice from Moyasar's API
   with the secret key and require status `paid`, SAR, exact amount and matching metadata:
   - return to `/settings/billing?attempt=…`
   - Moyasar `callback_url` → `/api/billing/moyasar/callback`
   - dashboard webhook → `/api/billing/moyasar/webhook` (secret_token checked)
5. `settle_platform_card_payment()` marks the invoice paid (method `card`), sets the tenant to
   `active_paid` and writes one audit entry. Replays are no-ops. A charge on an invoice that was
   already paid is flagged `card_payment_duplicate` in the audit log for a refund.

## Setup
1. Create a Moyasar account (https://moyasar.com) and complete merchant activation (CR, IBAN).
2. Vercel → Project → Settings → Environment Variables (Production):
   - `MOYASAR_SECRET_KEY` = `sk_test_…` (switch to `sk_live_…` after activation)
   - `MOYASAR_WEBHOOK_SECRET` = a random 32+ character string
   - `NEXT_PUBLIC_APP_URL` = `https://<your-domain>`
3. Moyasar Dashboard → Settings → Webhooks → Add: URL `https://<your-domain>/api/billing/moyasar/webhook`,
   method POST, same secret token, events `payment_paid`, `payment_failed`, `payment_refunded`.
4. Enable Apple Pay in the Moyasar dashboard (domain verification) if wanted.
5. Redeploy. Test with Moyasar's test cards, then switch to the live key.
