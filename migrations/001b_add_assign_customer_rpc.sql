-- ════════════════════════════════════════════════════════════════════════════
-- Migration 001b: Add assign_customer_id() RPC
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run this AFTER 001_two_table_redesign.sql is already in place.
-- It only adds the RPC the new PHP code calls — it does not modify any tables.
--
-- The PHP layer calls this via POST /rest/v1/rpc/assign_customer_id with
-- {"p_email": "user@example.com"}. It returns the CustomerID (existing or new).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION assign_customer_id(p_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email text := lower(trim(p_email));
    v_id    integer;
BEGIN
    IF v_email IS NULL OR v_email = '' THEN
        RAISE EXCEPTION 'email cannot be empty';
    END IF;

    SELECT "CustomerID" INTO v_id
    FROM customer_lookup
    WHERE "UserEmail" = v_email;

    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    v_id := nextval('customer_id_seq');

    INSERT INTO customer_lookup ("CustomerID", "UserEmail")
    VALUES (v_id, v_email)
    ON CONFLICT ("UserEmail") DO NOTHING;

    SELECT "CustomerID" INTO v_id
    FROM customer_lookup
    WHERE "UserEmail" = v_email;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_customer_id(text) TO anon, authenticated, service_role;

-- Quick smoke test (returns 1 for the dev account):
--   SELECT assign_customer_id('shreyashchandak.lx@gmail.com');
-- Quick smoke test for a new email (returns next sequence value, then same on repeat):
--   SELECT assign_customer_id('test_new_user@example.com');
--   SELECT assign_customer_id('test_new_user@example.com'); -- same as above
