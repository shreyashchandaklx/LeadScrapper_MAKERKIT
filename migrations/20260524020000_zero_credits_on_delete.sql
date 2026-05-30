-- Bug fix: Makerkit's webhook handler DELETEs the subscriptions row on
-- customer.subscription.deleted (not UPDATE status=canceled). Our existing
-- AFTER UPDATE trigger never fires for real period-end cancellations.
--
-- Fix: add an AFTER DELETE trigger that zeros credits + logs revocation.
-- Keep the AFTER UPDATE trigger too — it still handles unpaid / incomplete_expired
-- status transitions that don't go through DELETE.

set check_function_bodies = off;

-- ─── Trigger function for DELETE ────────────────────────────────────────────
-- For DELETE, NEW is null and OLD has the row being deleted.
create or replace function public.zero_credits_on_subscription_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_email text;
    v_previous_credits numeric;
begin
    -- Only act if the row was active or trialing (or canceled mid-transition).
    -- If the row was already in a terminal state pre-delete, skip — the AFTER UPDATE
    -- trigger already handled it.
    if old.status not in ('active', 'trialing', 'past_due', 'paused', 'canceled') then
        return old;
    end if;

    -- Resolve email
    select email into v_email
      from public.accounts
     where id = old.account_id;

    if v_email is null then
        raise log 'zero_credits_on_subscription_delete: no email for account_id %', old.account_id;
        return old;
    end if;

    -- Read current balance
    select "Credits" into v_previous_credits
      from public.user_credits
     where "Email" = v_email;

    if v_previous_credits is null or v_previous_credits = 0 then
        return old;  -- nothing to zero
    end if;

    -- Zero the wallet
    update public.user_credits
       set "Credits"   = 0,
           "UpdatedAt" = now()
     where "Email" = v_email;

    -- Audit log
    insert into public.credit_revocations (
        subscription_id, account_id, email, previous_credits, revoked_reason
    ) values (
        old.id, old.account_id, v_email, v_previous_credits, 'deleted'
    );

    return old;
end;
$$;

revoke all on function public.zero_credits_on_subscription_delete() from public, authenticated, anon;

drop trigger if exists tr_zero_credits_on_subscription_delete on public.subscriptions;

create trigger tr_zero_credits_on_subscription_delete
after delete on public.subscriptions
for each row
execute function public.zero_credits_on_subscription_delete();
