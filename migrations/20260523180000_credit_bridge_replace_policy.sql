-- Credit bridge v3: replace-policy + renewal trigger
--
-- Sir's policy:
--   1. Plan switch -> wallet REPLACED with new plan's credits (not incremented)
--   2. Renewal     -> wallet RESET to plan's credits (no rollover of unused)
-- Both collapse to: "set wallet to plan amount on any plan change or new period."
--
-- Three fixes vs v2:
--   A. Idempotency key adds product_id so plan switches within a period grant fresh credits
--   B. Trigger SETS the wallet instead of adding to it
--   C. Second trigger on public.subscriptions catches renewals (period_starts_at change),
--      which don't touch subscription_items so the v2 trigger missed them.

set check_function_bodies = off;

-- A. Update idempotency key on credit_grants ────────────────────────────────
do $$
declare
    v_constraint_name text;
begin
    select conname into v_constraint_name
      from pg_constraint
     where conrelid = 'public.credit_grants'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) like '%subscription_id%period_starts_at%'
       and pg_get_constraintdef(oid) not like '%product_id%'
     limit 1;

    if v_constraint_name is not null then
        execute format('alter table public.credit_grants drop constraint %I', v_constraint_name);
    end if;
end;
$$;

alter table public.credit_grants
    drop constraint if exists credit_grants_unique_grant;
alter table public.credit_grants
    add constraint credit_grants_unique_grant
    unique (subscription_id, period_starts_at, product_id);

-- B. Rewrite trigger function: set wallet, not add ──────────────────────────
-- Handles both subscription_items triggers (initial sub, plan switch) and
-- subscriptions triggers (renewal). Reads product_id from whichever fired.

create or replace function public.grant_subscription_credits()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_sub_id text;
    v_product_id varchar(255);
    v_sub public.subscriptions%rowtype;
    v_email text;
    v_credits integer;
    v_grant_inserted boolean := false;
begin
    -- Which table fired us?
    if tg_table_name = 'subscription_items' then
        v_sub_id := new.subscription_id;
        v_product_id := new.product_id;
    elsif tg_table_name = 'subscriptions' then
        v_sub_id := new.id;
        -- Look up current product_id from items
        select product_id into v_product_id
          from public.subscription_items
         where subscription_id = v_sub_id
         limit 1;

        if v_product_id is null then
            raise log 'grant_subscription_credits: no items yet for sub % (probably mid-insert), skipping; items trigger will handle.', v_sub_id;
            return new;
        end if;
    else
        return new;
    end if;

    -- Load parent subscription
    select * into v_sub
      from public.subscriptions
     where id = v_sub_id;

    if v_sub.id is null then
        raise log 'grant_subscription_credits: no subscriptions row for id %', v_sub_id;
        return new;
    end if;

    -- Only act on active or trialing subs
    if not (v_sub.status in ('active', 'trialing') and coalesce(v_sub.active, false)) then
        return new;
    end if;

    -- Resolve email from accounts
    select email into v_email
      from public.accounts
     where id = v_sub.account_id;

    if v_email is null then
        raise log 'grant_subscription_credits: no email for account_id %', v_sub.account_id;
        return new;
    end if;

    -- Credits for this product
    select credits into v_credits
      from public.plan_credits
     where product_id = v_product_id;

    if v_credits is null then
        raise log 'grant_subscription_credits: no plan_credits entry for product %', v_product_id;
        return new;
    end if;

    -- Idempotent insert: key is (sub, period, product). Webhook retries cannot duplicate.
    -- A plan switch creates a new (product) key; a renewal creates a new (period) key.
    begin
        insert into public.credit_grants (
            subscription_id, account_id, email, product_id,
            period_starts_at, period_ends_at, credits_granted
        ) values (
            v_sub.id, v_sub.account_id, v_email, v_product_id,
            v_sub.period_starts_at, v_sub.period_ends_at, v_credits
        );
        v_grant_inserted := true;
    exception when unique_violation then
        return new;
    end;

    -- REPLACE wallet, do not increment. No rollover by design.
    if v_grant_inserted then
        update public.user_credits
           set "Credits"   = v_credits,
               "UpdatedAt" = now()
         where "Email" = v_email;

        if not found then
            insert into public.user_credits ("Email", "Credits", "UpdatedAt", created_at)
            select v_email, v_credits, now(), now()
            where not exists (
                select 1 from public.user_credits where "Email" = v_email
            );
        end if;
    end if;

    return new;
end;
$$;

revoke all on function public.grant_subscription_credits() from public, authenticated, anon;

-- C. Re-bind triggers ───────────────────────────────────────────────────────
drop trigger if exists tr_grant_subscription_credits on public.subscription_items;
drop trigger if exists tr_grant_subscription_credits on public.subscriptions;
drop trigger if exists tr_grant_subscription_credits_items on public.subscription_items;
drop trigger if exists tr_grant_subscription_credits_renewal on public.subscriptions;

-- Fires on initial subscribe and on plan switch
create trigger tr_grant_subscription_credits_items
after insert or update on public.subscription_items
for each row
execute function public.grant_subscription_credits();

-- Fires on renewal only (period_starts_at advances). Plan switches don't change
-- period, so this trigger correctly stays silent for those.
create trigger tr_grant_subscription_credits_renewal
after update on public.subscriptions
for each row
when (new.period_starts_at is distinct from old.period_starts_at)
execute function public.grant_subscription_credits();

-- Backfill: re-fire trigger for all active subs to apply replace-policy now.
-- Idempotency key (sub, period, product) ensures no duplicate grant where one already exists.
-- The trigger will see the same (sub, period, product) tuple already in credit_grants for
-- subs that haven't changed plan and no-op them. For sir's upgraded sub, the product_id is
-- now Enterprise (different from the existing Starter grant) so a new grant inserts and
-- wallet snaps to 10,000.
do $$
declare
    r record;
begin
    for r in
        select si.subscription_id
          from public.subscription_items si
          join public.subscriptions s on s.id = si.subscription_id
         where s.status in ('active', 'trialing')
           and coalesce(s.active, false) = true
    loop
        update public.subscription_items
           set updated_at = now()
         where subscription_id = r.subscription_id;
    end loop;
end;
$$;
