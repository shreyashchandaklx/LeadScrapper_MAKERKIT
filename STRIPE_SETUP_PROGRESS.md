# Stripe Setup Progress

**Last updated:** 2026-05-24 (cancel policy finalized + DELETE trigger bug fix)
**Target:** Wire Stripe billing into Makerkit at `app.pixnom.com` so users can recharge a unified credit wallet usable across Lead Scrapper, Map2Web, and future tools.

---

## Quick context (read this first if resuming)

- **App:** Makerkit Next.js monorepo at `/root/next-supabase-saas-kit-turbo-main/apps/web` on VPS `74.208.208.186`, served by PM2 process `makerkit` on port 3000, fronted by nginx for `app.pixnom.com`.
- **Billing model:** Unified credit wallet. User subscribes monthly → credits land in `user_credits.Credits`. Lead Scrapper / Map2Web / future tools all debit from the same pool.
- **Tiers:** Starter (1,000 credits) / Pro (3,500 credits) / Enterprise (10,000 credits) — display prices $9.99 / $19.99 / $29.99, currently $0.50 in test mode.
- **Bridge architecture:** Makerkit handles Stripe (checkout, webhook, subscription state). A Supabase trigger fires `credits_top_up()` when Makerkit writes a successful subscription row. Clean separation — no Makerkit code is patched, no merge conflicts on future updates.

---

## Decisions locked

- [x] Billing model = unified credits across all Pixnom products
- [x] Currency = USD (LonarX LLC, US Stripe account)
- [x] 3 subscription tiers, monthly only (yearly deferred to v2)
- [x] No top-up packs in v1 (defer)
- [x] No Scale tier in v1 (defer)
- [x] Credits per tier: Starter 1000 / Pro 3500 / Enterprise 10000
- [x] Test prices = $0.50 each; live prices = $9.99 / $19.99 / $29.99 (recreate in live mode)
- [x] Credit amounts read from Stripe Product metadata (`credits: N`) — single source of truth
- [x] Bridge = Supabase trigger on Makerkit's subscriptions table (NOT custom code inside Makerkit)
- [x] Site URL = `https://app.pixnom.com`

---

## Done

### Stripe Dashboard
- [x] Stripe account active (LonarX LLC, US, sandbox/test mode)
- [x] Test API keys obtained (`pk_test_…51SSomSEmMi…`, `sk_test_…51SSomSEmMi…`)
- [x] 3 products created in test mode at $0.50/mo each:
  - [x] Pixnom Starter — `price_1TZaGaEmMiDjqdjcu6yde0oT`
  - [x] Pixnom Pro — `price_1TZaHVEmMiDjqdjcZ3augyj8`
  - [x] Pixnom Business (UI calls it Enterprise) — `price_1TZaHsEmMiDjqdjcxQfbKrCz`
- [x] Webhook endpoint registered: `https://app.pixnom.com/api/billing/webhook` (test mode, "vibrant-euphoria", 6 events, signing secret `whsec_VQJ9rwHuwuevGDWQ6F0FDZkRhRVj8Wf2`)
- [x] Customer Portal — Customer information section enabled

### VPS / Makerkit
- [x] Identified codebase location (`/root/next-supabase-saas-kit-turbo-main/apps/web`)
- [x] Confirmed Makerkit's built-in Stripe gateway (`@kit/billing-gateway`, `packages/billing/stripe/`) — no custom checkout/webhook code needed
- [x] Located stock billing UI: `apps/web/app/[locale]/home/(user)/billing/`
- [x] `billing.config.ts` replaced with 3 real Pixnom tiers (backup at `billing.config.ts.bak.20260521-180359`)
- [x] `.env.local` updated with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (backup at `.env.local.bak.20260521-181418`)
- [x] PM2 restarted with `--update-env`, makerkit process online and serving
- [x] **Production rebuild** (`pnpm build`) — needed because Next.js serves prebuilt bundle, config-only edits don't take effect without rebuild
- [x] Billing UI verified — Starter/Pro/Enterprise tiers render with new descriptions and feature pills; "Proceed to Payment" successfully creates Stripe Checkout session (confirmed in PM2 logs)
- [x] Customer Portal — Cancellations enabled (cancel at period end), Subscriptions enabled with all 3 products in switch list, Payment methods enabled, Invoice history enabled
- [x] Stripe product metadata `credits: 1000 / 3500 / 10000` added to Starter / Pro / Enterprise
- [x] Stripe product "Pixnom Business" renamed to "Pixnom Enterprise"

---

## Pending — pick up here next session

### 1. Browser sanity check (you, ~2 min)
- [x] Visit `https://app.pixnom.com/home/billing` — confirm UI shows Starter / Pro / Enterprise with new feature lists
- [x] Click "Proceed to Payment" on any tier — confirm Stripe Checkout opens (test mode banner, $0.50 shown). DO NOT complete payment yet — credit bridge isn't built.
- [x] Screenshot back if anything looks wrong

### 2. Stripe Dashboard tasks (you, ~5 min)
- [x] Add `credits` metadata to each Stripe product
- [x] Rename Stripe product "Pixnom Business" → "Pixnom Enterprise"
- [x] Finish Customer Portal config — Subscriptions + Payment methods + Invoice history all enabled

### 3. Credit bridge SQL (Claude, done 2026-05-22)
- [x] Wrote single migration `20260522000000_credit_bridge.sql` covering all 5 objects (plan_credits table+seed, credit_grants idempotency table, credits_top_up function, grant_subscription_credits trigger function, tr_grant_subscription_credits trigger on public.subscriptions)
- [x] Idempotency key = `(subscription_id, period_starts_at)` unique constraint on credit_grants — Stripe retries cannot double-grant
- [x] credits_top_up keyed by Email (not uuid) because user_credits is keyed by Email; trigger resolves email via accounts.email → accounts.id = subscriptions.account_id
- [x] Applied to remote Supabase project pixnom (ref fnevhniqvchvxwkqzjzg) via Supabase Studio SQL editor
- [x] **Bug found in v1:** Makerkit inserts `subscriptions` BEFORE `subscription_items`, so trigger fired on empty items and returned early — no grant. Fix migration `20260522010000_credit_bridge_fix_trigger_target.sql` moves the trigger to `subscription_items` and rewrites the function to read product_id from NEW (the item row), look up the parent subscription, then proceed.
- [x] **Second bug found:** `credits_top_up` raised exception when user_credits row didn't exist; backfill aborted on first such user (`shreyash04812@gmail.com`). Fix migration `20260522020000_credit_topup_upsert.sql` makes credits_top_up insert the row if missing (WHERE NOT EXISTS, race-safe).
- [x] Backfill via DO block at end of trigger-target migration grants credits for any pre-existing active subscriptions
- [x] **Third bug found:** Plan switch within a period was blocked by overly-strict idempotency key. Also v2 had no renewal trigger (subscriptions.period_starts_at updates didn't touch subscription_items). Migration `20260523180000_credit_bridge_replace_policy.sql` (a) adds `product_id` to credit_grants unique key so plan switches grant fresh credits, (b) rewrites trigger to REPLACE wallet (Credits = v_credits) instead of incrementing — implements sir's no-rollover policy, (c) adds a second trigger on public.subscriptions that fires only when `period_starts_at` changes (catches renewals), (d) backfills active subs so plan-switched wallets snap to the current plan's amount. Verified: sub_1TZbw2EmMiDjqdjcnXI9H4EK now has both Starter and Enterprise grants in credit_grants, wallet shows 10000.
- [x] **Cancel policy = zero credits at subscription end.** Migration `20260523200000_zero_credits_on_cancel.sql` adds (a) `credit_revocations` audit table mirroring credit_grants, (b) trigger on public.subscriptions firing only on terminal status transitions (canceled / incomplete_expired / unpaid — NOT past_due, NOT paused, NOT cancel_at_period_end flag). On fire: zeros user_credits.Credits, logs to credit_revocations with previous_credits + reason. Sir's policy: clicking Cancel keeps credits through paid period (Stripe sets cancel_at_period_end=true, status still active, trigger doesn't fire). Credits zero only when sub actually terminates and Stripe sends customer.subscription.deleted. "Change of mind" path (Cancel → Don't cancel) leaves credits intact. Verified via manual status flip: wallet went to 0, credit_revocations logged 3500 previous + reason=canceled.
- Files on VPS: `apps/web/supabase/migrations/20260522000000_credit_bridge.sql`, `20260522010000_credit_bridge_fix_trigger_target.sql`, `20260522020000_credit_topup_upsert.sql`
- Files locally: same names under `D:\Lead Scrapper PROD\migrations\`

### 4. End-to-end test (both, ~15 min)
- [x] Stripe test card `4242 4242 4242 4242` → subscribe to Starter
- [x] Confirm: Makerkit creates subscription row
- [x] Confirm: trigger fires, `user_credits.Credits` increments by 1000 (verified: shreyashchandak321 +1000, shreyash04812 +1000 from upsert)
- [x] Confirm: credit_grants row inserted with correct values, idempotency working
- [ ] Confirm: lead scrapper flow still debits correctly (no regression — verify after some lead activity)
- [x] Test cancel via Customer Portal — final policy verified 2026-05-24: clicking Cancel does NOT zero credits, wallet stays intact through the paid period. Only when status actually transitions to canceled/unpaid/incomplete_expired does the trigger fire and zero the wallet. After today's flip-flop (immediate-cancel then back), confirmed the revert is correct: WHEN clause is just (new.status IS DISTINCT FROM old.status), no cancel_at_period_end branch.
- [x] Test switch plan (Starter → Enterprise mid-cycle) — confirmed: wallet REPLACED with new plan's credits (10000), no rollover, fresh credit_grants row inserted with product_id in idempotency key
- [ ] Fire same webhook event twice manually — confirm only one credit grant lands (idempotency works because of unique constraint, but explicit test is worth doing)

### 5. Memory + docs (Claude, ~5 min)
- [ ] Update `MEMORY.md` — add Stripe billing setup memory pointing here
- [ ] Mark `STRIPE_BILLING_SETUP.md` as superseded by this progress doc OR fold it in

### 6. Go live (deferred to after test pass)
- [ ] Flip Stripe out of sandbox / test mode
- [ ] Recreate 3 products in **live mode** at real prices ($9.99 / $19.99 / $29.99) — Stripe prices are immutable, must recreate
- [ ] Add `credits` metadata to each live product
- [ ] Register **separate live-mode webhook** endpoint — get new `whsec_…`
- [ ] Swap `pk_test_` / `sk_test_` / `whsec_…` for live values in `.env.local`
- [ ] Update `billing.config.ts` with live `price_…` IDs (or use env vars — recommended)
- [ ] PM2 restart on VPS
- [ ] Test live transaction with a real card (refundable amount, then refund)

---

## Deferred to v2

- [ ] Yearly billing plans (UI toggle exists but no yearly Stripe prices yet)
- [ ] One-time top-up packs (for subscribers who exceed monthly allotment)
- [ ] Pixnom Scale tier (₹9999 / 30,000 credits or similar)
- [ ] Rollover policy (currently: unused credits behavior is whatever the trigger writes — likely additive, but document explicitly)
- [ ] Annual discount (~20% off vs monthly)
- [ ] Stripe Tax / GST for India customers (currently out of scope — USD only)
- [ ] Map2Web credit cost per action (Lead Scrapper debits 1 credit per lead via `credits_deduct_leads`; Map2Web needs its own debit hook with a per-action credit cost — planned: 1 credit per site generation)

---

## Key file paths (for fast resume)

| What | Where |
|---|---|
| Makerkit billing config | `/root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts` |
| Sample reference | `/root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.sample.config.ts` |
| Env vars | `/root/next-supabase-saas-kit-turbo-main/apps/web/.env.local` |
| Personal billing page | `/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/billing/` |
| Team billing page | `/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/[account]/billing/` |
| Stripe webhook handler | `/root/next-supabase-saas-kit-turbo-main/apps/web/app/api/billing/webhook/` |
| Existing credit API | `/root/next-supabase-saas-kit-turbo-main/apps/web/app/api/supabase/credits/` |
| Stripe gateway code (don't touch) | `/root/next-supabase-saas-kit-turbo-main/packages/billing/stripe/` |
| Nginx config | `/etc/nginx/sites-available/makerkit` |
| PM2 process name | `makerkit` (id 6, port 3000) |

## Restart command (memorize)

```bash
ssh root@74.208.208.186
source /root/.nvm/nvm.sh
pm2 restart makerkit --update-env
pm2 logs makerkit --lines 30 --nostream
```

## Backups created this session

- `apps/web/config/billing.config.ts.bak.20260521-180359`
- `apps/web/.env.local.bak.20260521-181418`

---

## Related docs

- `STRIPE_BILLING_SETUP.md` — original plan doc (some sections superseded by this progress file)
- Memory: `[[vps-deploy]]`, `[[makerkit-dev-emails]]`, `[[supabase-cache-schema]]`, `[[stripe-billing-plan]]`
