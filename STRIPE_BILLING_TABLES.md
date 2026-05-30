# Stripe Billing Tables — What Each One Does

Plain-English guide to every table involved in the Pixnom Stripe billing setup.

---

## Quick map

| Table | Built by | Purpose in one line |
|---|---|---|
| `plan_credits` | us | The menu — which plan gives how many credits |
| `credit_grants` | us | Log of every time credits were **added** to a wallet |
| `credit_revocations` | us | Log of every time a wallet was **zeroed** |
| `subscriptions` | Makerkit | The current Stripe subscription state per user |

---

## 1. `plan_credits` — the menu

A tiny lookup table that says **"this Stripe product = this many credits"**.

| product_id | credits | plan |
|---|---|---|
| `prod_UYhfulrVYWtZvK` | 1000 | Pixnom Starter |
| `prod_UYhgW4obglW9cU` | 3500 | Pixnom Pro |
| `prod_UYhhHvFM03MAb1` | 10000 | Pixnom Enterprise |

**When to touch it:** Adding a new plan, or renaming an existing one. Otherwise leave it alone.

**Why it's separate from code:** so adding a plan doesn't need a code deploy — just insert a row.

---

## 2. `credit_grants` — the "credits in" log

Every time a user **receives** credits, a row lands here.

**Example row:**
> On 2026-05-24, subscription `sub_1TZk3n…` granted **1,000 credits** to `shreyash@x.com` for product `prod_UYhfulrVYWtZvK` (Starter), for period starting May 24.

**Two jobs:**
1. **History** — answers "when did this user last get credits and how many?"
2. **Anti-duplicate** — has a unique constraint on `(subscription_id, period_starts_at, product_id)`. If Stripe sends the same webhook twice (their retries are real), the second row insert fails silently. **No double-grants.**

**Append-only.** Never edit or delete rows here.

---

## 3. `credit_revocations` — the "credits out" log

Every time a wallet is **zeroed**, a row lands here.

**Example rows from production:**
| subscription_id | previous_credits | reason | when |
|---|---|---|---|
| `sub_1TZbw2…` | 3500 | `canceled` | 2026-05-23 |
| `sub_1Tafoj…` | 10000 | `deleted` | 2026-05-24 |

**Why it exists:** support audit. If a user asks "where did my 10,000 credits go?" — you check this table and get an exact answer: when, how many, and why.

**Reasons logged:**
- `deleted` — Stripe deleted the sub (real period-end cancel)
- `canceled` — status went to canceled
- `unpaid` — payment failed permanently
- `incomplete_expired` — initial payment never completed

**Append-only.** Never edit or delete rows here.

---

## 4. `subscriptions` — the live Stripe state (Makerkit's)

**We did not create this — Makerkit ships with it.**

One row per **active** Stripe subscription. Makerkit's webhook handler keeps this in sync with Stripe automatically:

- User subscribes → row is **inserted**
- User changes plan or renews → row is **updated**
- Subscription ends → row is **deleted**

**Columns that matter to us:**
| Column | What it is |
|---|---|
| `id` | The Stripe `sub_xxx` ID |
| `account_id` | Links to `accounts` table → gives us the user's email |
| `status` | `active` / `trialing` / `canceled` / `unpaid` / etc. |
| `period_starts_at` / `period_ends_at` | The current billing period (used to detect renewals) |
| `cancel_at_period_end` | `true` when user clicked Cancel but period hasn't ended yet |

**How our triggers use it:**

- **Grant trigger** reads this to find which account is subscribing
- **Revoke trigger (UPDATE)** fires when `status` transitions to `canceled` / `unpaid` / `incomplete_expired`
- **Revoke trigger (DELETE)** fires when Makerkit deletes the row at real period-end (this is the common cancel path)

**⚠️ Do NOT manually edit this table.** Stripe is the source of truth — Makerkit will overwrite your changes on the next webhook.

---

## How the 4 tables work together

```
User pays Stripe
        ↓
Makerkit inserts → subscriptions  +  subscription_items
        ↓
Our trigger fires →
    reads → plan_credits  (how many credits?)
    writes → credit_grants (receipt)
    updates → user_credits.Credits  (the actual wallet)

─────────────────────────────────────────────────

User's plan ends (cancel takes effect, or unpaid)
        ↓
Makerkit either DELETEs the row, or UPDATEs status to terminal
        ↓
Our trigger fires →
    reads → user_credits.Credits  (current balance for audit)
    writes → credit_revocations  (audit row)
    updates → user_credits.Credits = 0  (wallet zeroed)
```

---

## The simplest mental model

- **`plan_credits`** = the **menu** (what costs what)
- **`credit_grants`** = the **"credits in"** log
- **`credit_revocations`** = the **"credits out"** log
- **`subscriptions`** = the **current state** (managed by Makerkit, don't touch)

One catalog + two logs + one live-state table managed by Makerkit. That's the whole billing data model.

---

## Related docs

- `STRIPE_SETUP_PROGRESS.md` — the live checklist for the whole Stripe rollout
- `STRIPE_BILLING_SETUP.md` — original plan doc
- Migrations: `migrations/20260522*` through `migrations/20260524*`
