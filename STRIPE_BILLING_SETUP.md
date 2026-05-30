# Stripe Billing Setup — Lead Scrapper (Makerkit Next.js)

**Date:** 2026-05-20
**Project:** Lead Scrapper PROD
**Target app:** Makerkit Next.js (`/root/next-supabase-saas-kit-turbo-main` on VPS `74.208.208.186`)
**Goal:** Wire Stripe to fund the existing `user_credits.Credits` balance that `credits_deduct_leads` already debits on every lead delivery.

---

## 0. Existing system this plugs into

The PHP side (`apify-proxy.php`) already calls Makerkit's `/api/supabase/credits/deduct-leads` on every delivery and `/api/supabase/credits/get` for balance reads. Dev emails (`isDevEmail` in `makerkit-api-credits/_lib.ts`) bypass both. Stripe's only job is to **top up `user_credits.Credits`** — it does not replace any of that logic.

That means the integration point is **one webhook handler** that increments `Credits` on successful payment. Everything else is configuration.

---

## 1. Decisions sir needs to make before any code is written

These shape the Stripe products, the pricing config file, and the webhook logic. Answer these first.

### 1.1 Billing model

- [ ] **Subscription** — monthly recurring (e.g. $19/mo gives 2,000 credits each month)
- [ ] **One-time top-ups** — pay-as-you-go (e.g. buy 1,000 credits for $10, no expiry)
- [ ] **Both** — sub for base allowance + top-ups for overage

### 1.2 Pricing tiers (fill in actual numbers)

| Plan | Price | Credits | Notes |
|------|-------|---------|-------|
| Free / trial | $0 | ? | Optional — how many free credits per signup? |
| Starter | $? | ? | |
| Pro | $? | ? | |
| Business | $? | ? | |
| Top-up pack S | $? | ? | One-time |
| Top-up pack M | $? | ? | One-time |
| Top-up pack L | $? | ? | One-time |

(Reminder: 1 credit = 1 delivered lead, since `CREDIT_PER_LEAD = 1` after the recent change… verify in `apify-proxy.php` before publishing prices.)

### 1.3 Behavior rules

- [ ] Do unused subscription credits **roll over** month-to-month, or reset?
- [ ] On subscription **downgrade** mid-cycle — prorate? Take effect next period?
- [ ] On subscription **cancel** — credits forfeited immediately or end of period?
- [ ] Trial period length (days)?
- [ ] Refund policy — does a refund claw back credits?

### 1.4 Currency & geography

- [ ] Primary currency (USD / INR / EUR …)?
- [ ] Single currency or multi?
- [ ] Tax — let Stripe Tax handle it, or out of scope for v1?

---

## 2. Stripe account prerequisites (sir does this in Stripe dashboard)

Nothing on the code side until these exist:

1. **Stripe account created** at https://dashboard.stripe.com — business details, bank account for payouts, tax ID.
2. **Account fully activated** (not just signed up — Stripe requires verification before live payments work).
3. **Test mode keys obtained** — these are used end-to-end before flipping to live.

---

## 3. Keys & secrets sir needs to give Claude

Paste these into `.env.local` of the Makerkit app (NEVER commit). Test-mode values for development, live-mode values when going to production.

### 3.1 From Stripe Dashboard → Developers → API keys

```env
# Test mode
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_PLACEHOLDER
STRIPE_SECRET_KEY=sk_test_PLACEHOLDER

# Live mode (only after end-to-end test pass)
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_PLACEHOLDER
# STRIPE_SECRET_KEY=sk_live_PLACEHOLDER
```

### 3.2 From Stripe Dashboard → Developers → Webhooks (or `stripe listen` CLI)

```env
# Local dev: from `stripe listen --forward-to localhost:3000/api/billing/webhook`
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx

# Production: from the webhook endpoint created in dashboard
# (different secret per endpoint — do not reuse the local one)
```

### 3.3 Stripe price IDs (created in step 5.2)

Will look like `price_1OabcDXYZ123...` — one per row in the pricing table above. Sir copies them from Stripe dashboard after creating products.

```env
STRIPE_PRICE_STARTER_MONTHLY=price_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_PRO_MONTHLY=price_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_BUSINESS_MONTHLY=price_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_TOPUP_SMALL=price_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_TOPUP_MEDIUM=price_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_TOPUP_LARGE=price_xxxxxxxxxxxxxxxxxxxxxxxx
```

### 3.4 Existing env (already configured — confirming for completeness)

```env
NEXT_PUBLIC_SITE_URL=https://leadscrapper.pixnom.com
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`NEXT_PUBLIC_SITE_URL` matters — Stripe Checkout uses it to build success/cancel URLs and the webhook origin.

---

## 4. Stripe dashboard work (sir does, Claude can guide)

### 4.1 Activate the account
Dashboard → Settings → Business settings → complete every red dot. Without this, live keys reject charges.

### 4.2 Create Products & Prices
Dashboard → Products → Add product. For each row in the pricing table:

- Subscription tier → recurring price, monthly interval
- Top-up pack → one-time price

After creating, copy the `price_xxx` ID into the env block above.

### 4.3 Configure Customer Portal
Dashboard → Settings → Billing → Customer portal → enable. Decide what customers can self-serve: cancel sub, update payment method, switch plan, view invoices. Makerkit links to this portal for "Manage subscription".

### 4.4 Create webhook endpoint (production)
Dashboard → Developers → Webhooks → Add endpoint:

- URL: `https://leadscrapper.pixnom.com/api/billing/webhook`
- Events to send (minimum):
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

Copy the signing secret → that's the live `STRIPE_WEBHOOK_SECRET`.

### 4.5 Enable Stripe Tax (optional, decide in §1.4)
Dashboard → Tax → enable, configure origin address and tax registrations.

---

## 5. Code work (Claude does, after §1–§4)

### 5.1 Install Stripe SDK
Already a Makerkit dep — confirm with `pnpm --filter web list stripe`. If missing: `pnpm --filter web add stripe @stripe/stripe-js`.

### 5.2 Billing config file
`apps/web/config/billing.config.ts` — define plans referencing the env price IDs from §3.3. Makerkit's billing schema validates this at build time, so the shape is enforced.

### 5.3 Checkout session route
`apps/web/app/api/billing/checkout/route.ts` — POST endpoint that creates a Stripe Checkout session for a given price ID and returns the redirect URL.

### 5.4 Webhook handler
`apps/web/app/api/billing/webhook/route.ts` — verify Stripe signature, then on:
- `checkout.session.completed` (one-time top-up) → look up user_id from session metadata → `UPDATE user_credits SET Credits = Credits + <packCredits>`
- `invoice.paid` (subscription) → top up monthly credit allotment for that user
- `customer.subscription.deleted` → flag user as no-sub (don't necessarily zero out their credits — that's a §1.3 decision)

### 5.5 Credit-top-up function in Supabase
New SQL function `credits_top_up(user_email, amount)` mirroring the existing `credits_deduct_leads` — atomic increment, returns new balance. Add to `migrations/` and apply.

### 5.6 UI surfaces
- `/settings/billing` page — current plan, credits remaining, "Upgrade" / "Buy credits" buttons → POST to checkout route
- "Manage subscription" → Stripe Customer Portal redirect
- Insufficient-credits state in lead scrapper UI → CTA to billing page

### 5.7 Dev-email behavior
`isDevEmail` users currently get `credits: 9999` from the bypass. Leave that alone — they don't go through Stripe at all. The webhook handler should skip top-ups for dev emails as a belt-and-braces measure (never actually triggered, since they wouldn't have a Stripe customer, but defensive).

---

## 6. Testing plan

### 6.1 Stripe test cards
- `4242 4242 4242 4242` — succeeds
- `4000 0000 0000 0002` — declined
- `4000 0025 0000 3155` — requires 3DS auth
- Any future expiry, any CVC

### 6.2 Local webhook testing
```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
# copy the whsec_ shown into .env.local
```

### 6.3 End-to-end checks
- [ ] Buy a top-up pack → `user_credits.Credits` increments by exactly the right amount
- [ ] Subscribe to a plan → first invoice triggers credit allotment
- [ ] Run a lead search → credits debit correctly (existing flow)
- [ ] Cancel subscription → behavior matches §1.3 decision
- [ ] Dev email account → unaffected, still shows 9999
- [ ] Webhook idempotency — fire the same event twice, balance only increments once (use `stripe_events` table or check `event.id` before processing)

---

## 7. Going live checklist

- [ ] Stripe account fully activated (not test mode)
- [ ] Live `pk_live_` / `sk_live_` keys in production `.env.local`
- [ ] Live webhook endpoint registered at `https://leadscrapper.pixnom.com/api/billing/webhook`
- [ ] Live `STRIPE_WEBHOOK_SECRET` swapped in
- [ ] Live price IDs (not test ones) in env
- [ ] Test transaction with a real card (refundable) to confirm end-to-end
- [ ] PM2 restart on VPS after env change: `pm2 restart all`

---

## 8. What sir still owes Claude

When sir comes back to continue this work, paste back answers to these and Claude can start coding:

1. **Billing model** (§1.1) — sub / top-up / both?
2. **Tiers + prices + credit counts** (§1.2)
3. **Behavior rules** (§1.3) — rollover, downgrade, cancel, trial, refund
4. **Currency** (§1.4)
5. **Stripe keys** (§3.1, §3.2) — test mode first
6. **Stripe price IDs** (§3.3) — after sir creates products in dashboard

Then Claude builds §5 end-to-end.

---

## 9. Related project memory

- `[[vps-deploy]]` — production server + reload commands
- `[[makerkit-dev-emails]]` — dev email bypass that Stripe must respect
- `[[supabase-cache-schema]]` — relevant if adding a `stripe_events` idempotency table

End of plan.
