-- Credit bridge: when Makerkit writes a subscription, top up user_credits.Credits.
-- Idempotent on (subscription_id, period_starts_at) so Stripe webhook retries are safe.

set check_function_bodies = off;

-- 1. Plan -> credits mapping (local source of truth, mirrors Stripe metadata)
create table if not exists public.plan_credits (
    product_id varchar(255) primary key,
    credits integer not null check (credits >= 0),
    notes text,
    created_at timestamptz not null default now()
);

insert into public.plan_credits (product_id, credits, notes) values
    ('prod_UYhfulrVYWtZvK', 1000,  'Pixnom Starter'),
    ('prod_UYhgW4obglW9cU', 3500,  'Pixnom Pro'),
    ('prod_UYhhHvFM03MAb1', 10000, 'Pixnom Enterprise')
on conflict (product_id) do update
    set credits = excluded.credits,
        notes   = excluded.notes;

alter table public.plan_credits enable row level security;
revoke all on public.plan_credits from authenticated, anon;
grant select on public.plan_credits to service_role;

-- 2. Append-only grant log (idempotency + audit trail)
create table if not exists public.credit_grants (
    id bigserial primary key,
    subscription_id text not null references public.subscriptions(id) on delete cascade,
    account_id uuid not null,
    email varchar(320) not null,
    product_id varchar(255) not null,
    period_starts_at timestamptz not null,
    period_ends_at timestamptz not null,
    credits_granted integer not null,
    granted_at timestamptz not null default now(),
    unique (subscription_id, period_starts_at)
);

create index if not exists ix_credit_grants_account on public.credit_grants (account_id);
create index if not exists ix_credit_grants_email on public.credit_grants (email);

alter table public.credit_grants enable row level security;
revoke all on public.credit_grants from authenticated, anon;
grant select on public.credit_grants to service_role;

drop policy if exists credit_grants_read_self on public.credit_grants;
create policy credit_grants_read_self on public.credit_grants for select
    to authenticated
    using (
        account_id in (
            select account_id from public.accounts_memberships
            where user_id = (select auth.uid())
        )
    );

-- 3. credits_top_up: atomic increment of user_credits.Credits, by email
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

    update public.user_credits
       set "Credits"  = coalesce("Credits", 0) + p_amount,
           "UpdatedAt" = now()
     where "Email" = p_email
     returning "Credits" into new_balance;

    if new_balance is null then
        raise exception 'credits_top_up: no user_credits row for email %', p_email;
    end if;

    return new_balance;
end;
$$;

revoke all on function public.credits_top_up(text, integer) from public, authenticated, anon;
grant execute on function public.credits_top_up(text, integer) to service_role;

-- 4. Trigger function: on subscription becoming active, grant credits exactly once per period
create or replace function public.grant_subscription_credits()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
    v_email text;
    v_product_id varchar(255);
    v_credits integer;
    v_grant_inserted boolean := false;
begin
    if not (new.status in ('active', 'trialing') and coalesce(new.active, false)) then
        return new;
    end if;

    if tg_op = 'UPDATE'
       and old.period_starts_at = new.period_starts_at
       and old.active = new.active
       and old.status = new.status then
        return new;
    end if;

    select email into v_email
      from public.accounts
     where id = new.account_id;

    if v_email is null then
        raise log 'grant_subscription_credits: no email for account_id %', new.account_id;
        return new;
    end if;

    select product_id into v_product_id
      from public.subscription_items
     where subscription_id = new.id
     limit 1;

    if v_product_id is null then
        raise log 'grant_subscription_credits: no subscription_items yet for sub %', new.id;
        return new;
    end if;

    select credits into v_credits
      from public.plan_credits
     where product_id = v_product_id;

    if v_credits is null then
        raise log 'grant_subscription_credits: no plan_credits entry for product %', v_product_id;
        return new;
    end if;

    begin
        insert into public.credit_grants (
            subscription_id, account_id, email, product_id,
            period_starts_at, period_ends_at, credits_granted
        ) values (
            new.id, new.account_id, v_email, v_product_id,
            new.period_starts_at, new.period_ends_at, v_credits
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

-- 5. Bind the trigger
drop trigger if exists tr_grant_subscription_credits on public.subscriptions;

create trigger tr_grant_subscription_credits
after insert or update on public.subscriptions
for each row
execute function public.grant_subscription_credits();
