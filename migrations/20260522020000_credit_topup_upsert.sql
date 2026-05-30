-- Make credits_top_up tolerant of missing user_credits rows.
-- If the row doesn't exist, insert it with Credits = amount.
-- Reason: a user can subscribe via Stripe before our app calls /credits/ensure.
-- Without this, payment succeeds but trigger aborts.
-- Uses INSERT ... WHERE NOT EXISTS to avoid requiring a unique constraint on Email.

set check_function_bodies = off;

create or replace function public.credits_top_up(
    p_email text,
    p_amount integer
) returns numeric
language plpgsql
security definer
set search_path to ''
as $$
declare
    new_balance numeric;
begin
    if p_amount <= 0 then
        raise exception 'credits_top_up: amount must be positive, got %', p_amount;
    end if;

    -- Try increment first (common case: row exists)
    update public.user_credits
       set "Credits"  = coalesce("Credits", 0) + p_amount,
           "UpdatedAt" = now()
     where "Email" = p_email
     returning "Credits" into new_balance;

    if new_balance is not null then
        return new_balance;
    end if;

    -- No row - insert it. Race-safe because credit_grants idempotency means
    -- the trigger only runs this path once per (subscription_id, period).
    insert into public.user_credits ("Email", "Credits", "UpdatedAt", created_at)
    select p_email, p_amount, now(), now()
    where not exists (
        select 1 from public.user_credits where "Email" = p_email
    )
    returning "Credits" into new_balance;

    if new_balance is null then
        -- Race condition: another transaction created the row between our update and insert.
        -- Retry the update so the amount lands.
        update public.user_credits
           set "Credits"  = coalesce("Credits", 0) + p_amount,
               "UpdatedAt" = now()
         where "Email" = p_email
         returning "Credits" into new_balance;
    end if;

    return new_balance;
end;
$$;

revoke all on function public.credits_top_up(text, integer) from public, authenticated, anon;
grant execute on function public.credits_top_up(text, integer) to service_role;

-- Re-run the backfill now that the function tolerates missing rows.
-- Idempotent: credit_grants unique constraint prevents double-grant.
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
        update public.subscription_items
           set updated_at = now()
         where subscription_id = r.subscription_id
           and product_id = r.product_id;
    end loop;
end;
$$;
