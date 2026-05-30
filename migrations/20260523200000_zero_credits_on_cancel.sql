-- Zero credits when subscription terminates.
-- Fires when status transitions to a terminal state (canceled / incomplete_expired / unpaid).
-- Does NOT fire on cancel_at_period_end=true alone — user keeps credits through the period they paid for.
-- This means the "change of mind" path (cancel then uncancel) leaves credits intact.
--
-- Sir's policy: no subscription = no credits.

set check_function_bodies = off;

-- Audit log of revocations (mirror of credit_grants for the reverse direction)
create table if not exists public.credit_revocations (
    id bigserial primary key,
    subscription_id text not null,
    account_id uuid not null,
    email varchar(320) not null,
    previous_credits numeric not null,
    revoked_reason text not null,
    revoked_at timestamptz not null default now()
);

create index if not exists ix_credit_revocations_email on public.credit_revocations (email);

alter table public.credit_revocations enable row level security;
revoke all on public.credit_revocations from authenticated, anon;
grant select on public.credit_revocations to service_role;

drop policy if exists credit_revocations_read_self on public.credit_revocations;
create policy credit_revocations_read_self on public.credit_revocations for select
    to authenticated
    using (
        account_id in (
            select account_id from public.accounts_memberships
            where user_id = (select auth.uid())
        )
    );

-- Trigger function: zero credits when subscription terminates
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
    -- Only act on transition INTO a terminal state
    if not (
        new.status in ('canceled', 'incomplete_expired', 'unpaid')
        and old.status is distinct from new.status
    ) then
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

    -- Read current balance so we can log it
    select "Credits" into v_previous_credits
      from public.user_credits
     where "Email" = v_email;

    if v_previous_credits is null then
        -- No credits row at all — nothing to revoke, no log needed
        return new;
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
        new.id, new.account_id, v_email, v_previous_credits, new.status::text
    );

    return new;
end;
$$;

revoke all on function public.zero_credits_on_subscription_end() from public, authenticated, anon;

drop trigger if exists tr_zero_credits_on_subscription_end on public.subscriptions;

create trigger tr_zero_credits_on_subscription_end
after update on public.subscriptions
for each row
when (new.status is distinct from old.status)
execute function public.zero_credits_on_subscription_end();
