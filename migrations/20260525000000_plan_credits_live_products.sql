-- Add live-mode Stripe product IDs to plan_credits.
-- Test-mode rows stay (harmless — unused once we're on live, useful for rollback).
-- Live products from Stripe Live mode (created 2026-05-25):
--   Starter    $29.99/mo   prod_Ua2dIrbgs4xJ6M
--   Pro        $59.99/mo   prod_Ua2eOokfWQDWLu
--   Enterprise $99.99/mo   prod_Ua2eQGNKpKbreR

insert into public.plan_credits (product_id, credits) values
    ('prod_Ua2dIrbgs4xJ6M', 1000),   -- Pixnom Starter (live)
    ('prod_Ua2eOokfWQDWLu', 3500),   -- Pixnom Pro (live)
    ('prod_Ua2eQGNKpKbreR', 10000)   -- Pixnom Enterprise (live)
on conflict (product_id) do update
    set credits = excluded.credits;

-- Verify
select product_id, credits
  from public.plan_credits
 order by credits;
