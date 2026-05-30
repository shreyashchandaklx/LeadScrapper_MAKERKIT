-- Fix: original trigger fired on public.subscriptions INSERT, but Makerkit's
-- add_subscription RPC inserts subscriptions FIRST and subscription_items after.
-- At trigger time, subscription_items is still empty, trigger returns early
-- (no product_id), credits never granted.
-- Fix: move trigger to subscription_items so we have everything we need.

set check_function_bodies = off;

-- Drop the old trigger on subscriptions
drop trigger if exists tr_grant_subscription_credits on public.subscriptions;

-- Replace the trigger function: NEW now refers to a subscription_items row
create or replace function public.grant_subscription_credits()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_sub public.subscriptions%rowtype;
    v_email text;
    v_credits integer;
    v_grant_inserted boolean := false;
begin
    -- Look up the parent subscription
    select * into v_sub
      from public.subscriptions
     where id = new.subscription_id;

    if v_sub.id is null then
        raise log 'grant_subscription_credits: no subscription row for id %', new.subscription_id;
        return new;
    end if;

    -- Only act when the subscription is active or trialing
    if not (v_sub.status in ('active', 'trialing') and coalesce(v_sub.active, false)) then
        return new;
    end if;

    -- Resolve the email from accounts
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
     where product_id = new.product_id;

    if v_credits is null then
        raise log 'grant_subscription_credits: no plan_credits entry for product %', new.product_id;
        return new;
    end if;

    -- Idempotent insert
    begin
        insert into public.credit_grants (
            subscription_id, account_id, email, product_id,
            period_starts_at, period_ends_at, credits_granted
        ) values (
            v_sub.id, v_sub.account_id, v_email, new.product_id,
            v_sub.period_starts_at, v_sub.period_ends_at, v_credits
        );
        v_grant_inserted := true;
    exception when unique_violation then
        return new;
    end;

    if v_grant_inserted then
        perform public.credits_top_up(v_email, v_credits);
    end if;

    return new;
end;
$$;

revoke all on function public.grant_subscription_credits() from public, authenticated, anon;

-- Bind on subscription_items now
create trigger tr_grant_subscription_credits
after insert or update on public.subscription_items
for each row
execute function public.grant_subscription_credits();

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill: grant credits for the already-existing subscription that the
-- broken v1 trigger missed. Idempotent — won't double-grant if you re-run.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
    r record;
begin
    for r in
        select si.subscription_id, si.product_id
          from public.subscription_items si
          join public.subscriptions s on s.id = si.subscription_id
         where s.status in ('active', 'trialing')
           and coalesce(s.active, false) = true
    loop
        -- Simulate the trigger by issuing an UPDATE on the item.
        -- Trigger fires, runs all checks, idempotent insert handles dedup.
        update public.subscription_items
           set updated_at = now()
         where subscription_id = r.subscription_id
           and product_id = r.product_id;
    end loop;
end;
$$;
