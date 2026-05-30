-- Tighten zero-on-cancel policy:
-- (1) status -> canceled / unpaid / incomplete_expired   (already handled)
-- (2) cancel_at_period_end flips from false to true      (NEW — handles "cancel scheduled" too)
--
-- Reason: sir's policy is "credits zero the moment user cancels", not "zero at period end".
-- The Stripe Customer Portal config should also be flipped to "Cancel immediately" so
-- subscription.deleted lands right away. This trigger is a belt-and-braces second mechanism.

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
    v_reason text;
begin
    -- Determine if this UPDATE represents a "subscription has ended for the user" event
    v_reason := null;

    if new.status in ('canceled', 'incomplete_expired', 'unpaid')
       and (old.status is distinct from new.status)
    then
        v_reason := new.status::text;
    elsif coalesce(new.cancel_at_period_end, false) = true
          and coalesce(old.cancel_at_period_end, false) = false
    then
        v_reason := 'cancel_at_period_end';
    end if;

    if v_reason is null then
        return new;
    end if;

    -- Resolve email from account
    select email into v_email
      from public.accounts
     where id = new.account_id;

    if v_email is null then
        raise log 'zero_credits_on_subscription_end: no email for account_id %', new.account_id;
        return new;
    end if;

    -- Read current balance for logging
    select "Credits" into v_previous_credits
      from public.user_credits
     where "Email" = v_email;

    if v_previous_credits is null then
        return new;
    end if;

    -- Zero the wallet
    update public.user_credits
       set "Credits"   = 0,
           "UpdatedAt" = now()
     where "Email" = v_email;

    insert into public.credit_revocations (
        subscription_id, account_id, email, previous_credits, revoked_reason
    ) values (
        new.id, new.account_id, v_email, v_previous_credits, v_reason
    );

    return new;
end;
$$;

revoke all on function public.zero_credits_on_subscription_end() from public, authenticated, anon;

-- Re-bind trigger so it fires on status OR cancel_at_period_end changes
drop trigger if exists tr_zero_credits_on_subscription_end on public.subscriptions;

create trigger tr_zero_credits_on_subscription_end
after update on public.subscriptions
for each row
when (
    new.status is distinct from old.status
    or coalesce(new.cancel_at_period_end, false) is distinct from coalesce(old.cancel_at_period_end, false)
)
execute function public.zero_credits_on_subscription_end();
