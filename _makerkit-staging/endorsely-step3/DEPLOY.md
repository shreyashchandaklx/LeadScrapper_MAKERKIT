# Endorsely Step 3 — Send referral ID to Stripe Checkout

Date: 2026-06-05

## What this does

When a visitor lands via an affiliate link, `endorsely.js` (already live on all
pages) sets `window.endorsely_referral`. These changes pass that ID through the
checkout chain so it lands in the Stripe Checkout Session metadata as
`endorsely_referral`, which Endorsely reads to attribute the conversion.

Chain: checkout form (browser) → server action schema → user billing service →
billing gateway (already passes `metadata` through) → `stripe.checkout.sessions.create`.

The stripe service also spreads `params.metadata` into `subscription_data.metadata`,
so subscriptions get the referral too.

## Upload map (WinSCP) — 4 files

Local folder: `D:\Lead Scrapper PROD\_makerkit-staging\endorsely-step3\`
VPS base: `/root/next-supabase-saas-kit-turbo-main/`

| Local file | → VPS destination |
|---|---|
| `personal-account-checkout.schema.ts` | `apps/web/app/[locale]/home/(user)/billing/_lib/schema/personal-account-checkout.schema.ts` |
| `personal-account-checkout-form.tsx` | `apps/web/app/[locale]/home/(user)/billing/_components/personal-account-checkout-form.tsx` |
| `user-billing.service.ts` | `apps/web/app/[locale]/home/(user)/billing/_lib/server/user-billing.service.ts` |
| `create-stripe-checkout.ts` | `packages/billing/stripe/src/services/create-stripe-checkout.ts` |

## After upload — rebuild

```bash
export PATH=/root/.nvm/versions/node/v20.18.0/bin:$PATH
cd /root/next-supabase-saas-kit-turbo-main
pnpm build
pm2 restart makerkit   # NOT "web" — process name is makerkit
```

## Verify

1. Open app.pixnom.com with an affiliate link (`?via=...` from Endorsely test link)
2. DevTools console: `window.endorsely_referral` should print a UUID
3. Go to billing, pick a plan → in Stripe Dashboard → the new Checkout Session
   should show metadata `endorsely_referral: <uuid>`
4. Endorsely dashboard Step 3 should turn green after first tracked checkout

## Changes summary

- `personal-account-checkout.schema.ts`: added optional `referralId` (max 128 chars)
- `personal-account-checkout-form.tsx`: reads `window.endorsely_referral` on
  plan submit, passes as `referralId`
- `user-billing.service.ts`: accepts `referralId`, forwards as
  `metadata: { endorsely_referral: referralId }` to the gateway
- `create-stripe-checkout.ts`: passes `metadata: params.metadata` at the
  session level (subscription_data already spread it)
