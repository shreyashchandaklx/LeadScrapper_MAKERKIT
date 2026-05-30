# Stripe Product Configuration — Live Deployment + Add-New-Product Guide

**Created:** 2026-05-25 (immediately after live go-live deployment)
**Audience:** You (sir) — so you can manage Stripe products without waiting for me.

This doc has **two parts:**
1. **What I did during go-live** — every command, every file changed, in order, so you know what's where
2. **How to add a new product** — step-by-step recipe you can follow alone next time

---

# PART 1 — What I did when you gave me the live Stripe keys

You sent me these values on 2026-05-25:

| Variable | Value |
|---|---|
| `pk_live_` | `pk_live_PLACEHOLDER` |
| `sk_live_` | `sk_live_PLACEHOLDER` |
| `whsec_` (live) | `whsec_PLACEHOLDER` |
| **Starter** | `price_1TasYEEmMiDjqdjcTzQnQkoO` / `prod_Ua2dIrbgs4xJ6M` — **$29.99/mo** |
| **Pro** | `price_1TasZCEmMiDjqdjcl3Y6CvP5` / `prod_Ua2eOokfWQDWLu` — **$59.99/mo** |
| **Enterprise** | `price_1TasZaEmMiDjqdjcY0gXmCRU` / `prod_Ua2eQGNKpKbreR` — **$99.99/mo** |

Then I ran these steps **on the VPS `74.208.208.186`** as `root`:

---

## Step 1 — Backed up the existing `.env.production.local`

**Why:** safety. If anything breaks, restore the backup with `cp`.

```bash
ssh root@74.208.208.186
# (password: PASSWORD_PLACEHOLDER)

cd /root/next-supabase-saas-kit-turbo-main/apps/web/
cp .env.production.local .env.production.local.bak.golive-$(date +%Y%m%d-%H%M%S)
```

This created `.env.production.local.bak.golive-20260525-135912`.

---

## Step 2 — Wrote new `.env.production.local` with live keys

**File path:** `/root/next-supabase-saas-kit-turbo-main/apps/web/.env.production.local`

**Replaced** test-mode values with live-mode values. **Preserved** non-Stripe vars (Supabase, dev emails, Map2Web API key).

```bash
cat > /root/next-supabase-saas-kit-turbo-main/apps/web/.env.production.local << 'ENVEOF'
# LIVE MODE Stripe — switched 2026-05-25
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_PLACEHOLDER
STRIPE_SECRET_KEY=sk_live_PLACEHOLDER
STRIPE_WEBHOOK_SECRET=whsec_PLACEHOLDER

SUPABASE_SECRET_KEY=sb_secret_PLACEHOLDER
DEV_EMAILS=shreyashchandak.lx@gmail.com,shriganeshkolhe@gmail.com
M2W_API_KEY=m2w_sk_PLACEHOLDER
ENVEOF
```

---

## Step 3 — Replaced test `price_...` IDs with live `price_...` IDs

**File path:** `/root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts`

**Why:** this file tells Makerkit which Stripe Price to charge. The IDs differ between test and live modes.

```bash
# Backup first
cp /root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts \
   /root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts.bak.golive-$(date +%Y%m%d-%H%M%S)

# Swap test → live price IDs
sed -i "s/price_1TZaGaEmMiDjqdjcu6yde0oT/price_1TasYEEmMiDjqdjcTzQnQkoO/g; \
        s/price_1TZaHVEmMiDjqdjcZ3augyj8/price_1TasZCEmMiDjqdjcl3Y6CvP5/g; \
        s/price_1TZaHsEmMiDjqdjcxQfbKrCz/price_1TasZaEmMiDjqdjcY0gXmCRU/g" \
   /root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts
```

---

## Step 4 — Fixed display prices (`cost` field) to match Stripe live prices

**Why:** the UI shows whatever `cost: X.XX` says in the config — NOT what Stripe charges. If they don't match, users see one price and get charged another. **Bait-and-switch — must avoid.**

Updated all three `cost:` values:
- Starter: `cost: 9.99` → `cost: 29.99`
- Pro: `cost: 19.99` → `cost: 59.99`
- Enterprise: `cost: 29.99` → `cost: 99.99`

(I had to be careful with `sed` ordering since old Enterprise price overlapped with new Starter price.)

---

## Step 5 — Added live `prod_...` IDs to Supabase `plan_credits` table

**Why:** our credit-grant trigger reads `plan_credits` to know how many credits to give per product. Test product IDs are different from live product IDs, so we needed to add the live ones.

**Migration file created locally:** `D:\Lead Scrapper PROD\migrations\20260525000000_plan_credits_live_products.sql`
**Uploaded to VPS at:** `/root/next-supabase-saas-kit-turbo-main/apps/web/supabase/migrations/20260525000000_plan_credits_live_products.sql`

**Applied via Supabase Studio SQL Editor:**

```sql
insert into public.plan_credits (product_id, credits) values
    ('prod_Ua2dIrbgs4xJ6M', 1000),   -- Pixnom Starter (live)
    ('prod_Ua2eOokfWQDWLu', 3500),   -- Pixnom Pro (live)
    ('prod_Ua2eQGNKpKbreR', 10000)   -- Pixnom Enterprise (live)
on conflict (product_id) do update
    set credits = excluded.credits;
```

After this, `plan_credits` has **6 rows** (3 test + 3 live). The test rows are harmless leftovers — they'd only fire if someone subscribed via a test webhook, which can't happen with live keys.

---

## Step 6 — Rebuilt Makerkit

**Why:** Next.js compiles `billing.config.ts` into the build artifact at build time. Just editing the file does NOTHING — you must rebuild.

```bash
ssh root@74.208.208.186
source /root/.nvm/nvm.sh
cd /root/next-supabase-saas-kit-turbo-main
nohup pnpm --filter web build > /tmp/golive-build.log 2>&1 &
# Wait ~1-2 min until BUILD_ID is updated
tail -30 /tmp/golive-build.log
```

Build artifact location: `/root/next-supabase-saas-kit-turbo-main/apps/web/.next/`

---

## Step 7 — Restarted PM2 with new env vars

```bash
pm2 restart makerkit --update-env
pm2 status makerkit
pm2 logs makerkit --lines 20 --nostream
```

**Important flags:**
- `--update-env` — re-reads `.env.production.local`. Without this, PM2 uses cached env vars.
- Confirm `status` is `online` and uptime is fresh (seconds, not hours).

---

## Step 8 — Verified

| Check | How |
|---|---|
| Build is fresh | `stat /root/next-supabase-saas-kit-turbo-main/apps/web/.next/BUILD_ID --format='%y'` |
| Live keys loaded | `pm2 logs makerkit --lines 30 --nostream` — look for "Ready in Xms" with no Stripe errors |
| Webhook responds | Stripe Dashboard → Developers → Webhooks → "Live" endpoint → recent attempts show `200 OK` |
| Prices on UI match Stripe | Visit `https://app.pixnom.com/home/billing` and hard-refresh (Ctrl+Shift+R) |

---

# PART 2 — How to ADD a new product (do this alone)

Use this anytime you want to add a new tier (e.g. "Pixnom Scale" at $199.99/mo with 50,000 credits) or a one-time top-up pack.

## A. Stripe Dashboard side (5 min)

### 1. Make sure you're in LIVE mode
Top-right toggle → **Live mode** (you don't want to accidentally create test products).

### 2. Create the product
Stripe Dashboard → **Products → Add product**

Fill in:
| Field | Value |
|---|---|
| Name | e.g. `Pixnom Scale` |
| Description | e.g. `50,000 credits per month — for high-volume teams` |
| Pricing model | **Recurring** (for subscriptions) or **One-time** (for top-up packs) |
| Price | e.g. `$199.99` USD |
| Billing period | **Monthly** (we don't offer yearly yet) |
| **Metadata** | Add key `credits` = value `50000` (for tracking; doesn't drive logic) |

Click **Save product**.

### 3. Copy the IDs
After saving, Stripe shows:
- **Product ID** — starts with `prod_...` (e.g. `prod_AbCd1234...`)
- **Price ID** — starts with `price_...` (e.g. `price_1Ab...`)

Save both somewhere — you need them in step B and C.

### 4. Add product to Customer Portal switch list
Stripe Dashboard → **Settings → Billing → Customer portal**
- Scroll to **Subscriptions → Subscription products**
- Click **Find a product** → search your new product → **add it to the list**
- Now existing users can switch INTO this plan from their billing page.

---

## B. Supabase side (1 min)

Add the new product to `plan_credits` so the credit-grant trigger knows how many credits to give.

Open **Supabase Studio SQL Editor**:
https://supabase.com/dashboard/project/fnevhniqvchvxwkqzjzg/sql/new

Run:

```sql
insert into public.plan_credits (product_id, credits) values
    ('prod_AbCd1234...', 50000)   -- ← REPLACE with your new product_id + credits
on conflict (product_id) do update
    set credits = excluded.credits;

-- Verify it's there
select product_id, credits from public.plan_credits order by credits;
```

---

## C. Makerkit side — VPS code change (5 min)

This is the only step that requires SSH. Without this, the new product **won't appear in the UI**.

### 1. SSH to VPS

```bash
ssh root@74.208.208.186
# password: PASSWORD_PLACEHOLDER
```

### 2. Backup the config file

```bash
cd /root/next-supabase-saas-kit-turbo-main/apps/web/config/
cp billing.config.ts billing.config.ts.bak.$(date +%Y%m%d-%H%M%S)
```

### 3. Edit `billing.config.ts`

Open in nano: `nano /root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts`

Add a new product block. Use Enterprise as a template (find the section starting with `id: 'enterprise'`). Copy that whole block and paste it AFTER, then change:

```typescript
{
  id: 'scale',                              // unique slug, lowercase
  name: 'Scale',                            // display name
  description:
    '50,000 credits per month — for high-volume teams',
  currency: 'USD',
  plans: [
    {
      name: 'Scale Monthly',
      id: 'scale-monthly',                  // unique slug
      paymentType: 'recurring',
      interval: 'month',
      lineItems: [
        {
          id: 'price_1Ab...',               // ← YOUR LIVE PRICE ID from Stripe
          name: 'Base',
          cost: 199.99,                     // ← YOUR DISPLAY PRICE (must match Stripe!)
          type: 'flat' as const,
        },
      ],
    },
  ],
  features: [
    '50,000 credits per month',
    'Use on Lead Scrapper',
    'Use on Map2Web',
    'Dedicated support',
    'Credits work across all current and future Pixnom tools',
  ],
},
```

Save: `Ctrl+O`, Enter, `Ctrl+X`.

### 4. Rebuild Makerkit

```bash
source /root/.nvm/nvm.sh
cd /root/next-supabase-saas-kit-turbo-main
pnpm --filter web build
# Wait ~1-2 min for build to finish
```

### 5. Restart PM2

```bash
pm2 restart makerkit --update-env
pm2 status makerkit
```

### 6. Verify
- Visit `https://app.pixnom.com/home/billing`
- Hard-refresh: **Ctrl + Shift + R**
- Confirm your new product appears with the correct price

---

## D. Common mistakes to avoid

| Mistake | What happens | Fix |
|---|---|---|
| Forgot to add row in `plan_credits` | Webhook fires, payment succeeds, **NO credits granted** (silent failure). | Run the SQL insert. Then either: re-trigger via `update subscription_items set updated_at = now() where ...`, OR just have the user re-subscribe. |
| `cost: X.XX` ≠ Stripe price | UI shows different price than Stripe charges → angry users | Make them match before deploying. |
| Skipped `pnpm build` | Config change has no effect, UI shows old products | Always build + restart after editing `billing.config.ts`. |
| Created product in **TEST** mode by mistake | UI shows it, but real cards fail at checkout | Recreate in **Live** mode. Stripe products are immutable, no fix. |
| Forgot `--update-env` on PM2 restart | PM2 uses cached env vars; new Stripe keys ignored | Always `pm2 restart makerkit --update-env`. |
| Didn't add to Customer Portal switch list | Existing users can't switch INTO new plan | Stripe Dashboard → Portal config → add product to list. |

---

## E. Removing/disabling a product

You can't delete a Stripe product if anyone is subscribed to it. To retire one:

1. **Stripe Dashboard → Products → [product] → Archive** (hides from new sales)
2. **Customer Portal:** remove from switch list (so existing users can't pick it as a new plan)
3. **`billing.config.ts`:** remove the block, rebuild, restart PM2
4. **Optional:** delete the `plan_credits` row only AFTER no active subs reference it (otherwise renewals would fail to grant credits)

Existing subscribers stay subscribed until they cancel or it ends.

---

# Quick reference card

## Restart commands (memorize)

```bash
ssh root@74.208.208.186
# password: PASSWORD_PLACEHOLDER

# After editing billing.config.ts:
source /root/.nvm/nvm.sh
cd /root/next-supabase-saas-kit-turbo-main
pnpm --filter web build
pm2 restart makerkit --update-env

# After editing .env.production.local (no rebuild needed):
pm2 restart makerkit --update-env

# Check logs:
pm2 logs makerkit --lines 30 --nostream
```

## Key file paths

| What | Where |
|---|---|
| Makerkit billing config | `/root/next-supabase-saas-kit-turbo-main/apps/web/config/billing.config.ts` |
| Env vars (live keys) | `/root/next-supabase-saas-kit-turbo-main/apps/web/.env.production.local` |
| Local migrations | `D:\Lead Scrapper PROD\migrations\` |
| VPS migrations | `/root/next-supabase-saas-kit-turbo-main/apps/web/supabase/migrations/` |
| Stripe webhook handler (don't touch) | `/root/next-supabase-saas-kit-turbo-main/apps/web/app/api/billing/webhook/` |
| Supabase SQL Editor | https://supabase.com/dashboard/project/fnevhniqvchvxwkqzjzg/sql/new |

## Backups created during go-live

- `apps/web/.env.production.local.bak.golive-20260525-135912` — pre-live env
- `apps/web/config/billing.config.ts.bak.golive-20260525-*` — pre-live config

## Related docs

- `STRIPE_SETUP_PROGRESS.md` — the master checklist with everything done so far
- `STRIPE_BILLING_TABLES.md` — what each database table does
- `STRIPE_BILLING_SETUP.md` — original planning doc

---

## When in doubt

If something looks wrong after a change:
1. **Check Stripe Dashboard → Developers → Webhooks → Recent attempts** — was it 200 OK?
2. **Check PM2 logs:** `pm2 logs makerkit --lines 50 --nostream`
3. **Check `plan_credits`:** `select * from plan_credits;` in Supabase
4. **Roll back:** restore the `.bak.golive-*` files and restart PM2

If still stuck, message me with: (a) what you changed, (b) what error you see, (c) screenshot of billing page + PM2 logs.
