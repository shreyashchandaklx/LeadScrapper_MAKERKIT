-- Revert today's "zero on cancel_at_period_end" change.
-- Sir's final policy: user paid for the month → keeps credits until period actually ends.
-- The trigger should ONLY fire when status truly becomes canceled / unpaid / incomplete_expired,
-- which Stripe sends when the subscription has actually ended.
-- (When user clicks Cancel and we use "Cancel at end of billing period" in Stripe Portal,
-- status stays 'active' with cancel_at_period_end=true; trigger does nothing; user keeps credits.
-- On the actual end date Stripe sends customer.subscription.deleted → status=canceled →
-- trigger fires → wallet zeroed.)

set check_function_bodies = off;

create or replace function public.zero_credits_on_subscription_end()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_email text;
    v_previous_credits numeric;
begin
    -- Only act on transition INTO a terminal state (no cancel_at_period_end branch).
    if not (
        new.status in ('canceled', 'incomplete_expired', 'unpaid')
        and old.status is distinct from new.status
    ) then
        return new;
    end if;

    select email into v_email
      from public.accounts
     where id = new.account_id;

    if v_email is null then
        raise log 'zero_credits_on_subscription_end: no email for account_id %', new.account_id;
        return new;
    end if;

    select "Credits" into v_previous_credits
      from public.user_credits
     where "Email" = v_email;

    if v_previous_credits is null then
        return new;
    end if;

    update public.user_credits
       set "Credits"   = 0,
           "UpdatedAt" = now()
     where "Email" = v_email;

    insert into public.credit_revocations (
        subscription_id, account_id, email, previous_credits, revoked_reason
    ) values (
        new.id, new.account_id, v_email, v_previous_credits, new.status::text
    );

    return new;
end;
$$;

revoke all on function public.zero_credits_on_subscription_end() from public, authenticated, anon;

-- Re-bind trigger with the narrower WHEN clause: only on real status change.
drop trigger if exists tr_zero_credits_on_subscription_end on public.subscriptions;

create trigger tr_zero_credits_on_subscription_end
after update on public.subscriptions
for each row
when (new.status is distinct from old.status)
execute function public.zero_credits_on_subscription_end();
