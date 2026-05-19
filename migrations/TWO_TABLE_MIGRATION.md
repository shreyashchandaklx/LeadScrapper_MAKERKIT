# Two-Table Redesign Migration — Runbook

## Final design

| Old (4 tables) | New (2 tables) |
|---|---|
| `leadscrapper_leads_data` — mixed (cache rows + user-saved leads) | `leadscrapper_leads_data` — pure scraped lead pool (same name, repurposed) |
| `leadscrapper_extras` | `user_leadscrapper_leads` — `Status='queued'` rows |
| `leadscrapper_delivered` | `user_leadscrapper_leads` — `Status='delivered'` rows |
| `leadscrapper_searches` | `user_leadscrapper_leads` — `Status='search'` rows |

Plus a small `customer_lookup` table for email ↔ CustomerID mapping.

## CustomerID assignment

- `shreyashchandak.lx@gmail.com` → CustomerID **1**
- `shriganeshkolhe@gmail.com` → CustomerID **2**
- All other existing users → 1001, 1002, 1003, ... (oldest activity first)
- New signups → next value from `customer_id_seq`

## Migration order

### Step 1 — Run the SQL migration

Open Supabase SQL editor → paste `migrations/001_two_table_redesign.sql` → Run.

**This is non-destructive.** It only CREATES new tables and COPIES data. Old tables stay intact.

### Step 2 — Verify the migration

Run the verification queries from Stage 5 of the SQL file. Confirm:

```sql
SELECT COUNT(*) FROM customer_lookup;
-- Expected: 2 (devs) + N (real users)

SELECT
  (SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'delivered') AS new_delivered,
  (SELECT COUNT(*) FROM leadscrapper_delivered)                                AS old_delivered,
  (SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'queued')    AS new_queued,
  (SELECT COUNT(*) FROM leadscrapper_extras)                                   AS old_extras,
  (SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'search')    AS new_search,
  (SELECT COUNT(*) FROM leadscrapper_searches)                                 AS old_searches;
-- Each new_* count should equal its old_* counterpart.
```

If anything's off, stop and investigate. The old tables are untouched so the live app still works.

### Step 3 — PHP refactor (next task)

After SQL migration is verified, we refactor:

1. `lib/credits.php` — point all helpers at `user_leadscrapper_leads`. Use CustomerID-first lookups, with email fallback.
2. `lib/supabase_cache.php` — point cache lookups at `leadscrapper_leads_data` (no more `UserEmail='__cache__'` sentinel filter). Cache rows become "every row in the master pool."
3. `apify-proxy.php` — pass CustomerID through `runKeyMap`, resolve via `customer_lookup` if not present.

### Step 4 — Test in production

Run the same searches we used before:
1. Lawyer + Pune + 411005 with two different users.
2. Verify cache hit on second user, correct delivered/queued counts, correct charging.
3. Confirm extras drain across re-runs.
4. Confirm delete from one user's Lead Manager doesn't affect the other user.

### Step 5 — Clean up (after 24h stable)

Run `migrations/002_drop_old_tables.sql`. This drops:
- `leadscrapper_extras`
- `leadscrapper_delivered`
- `leadscrapper_searches`
- `UserEmail='__cache__'` and `UserEmail='__pending__'` rows from `leadscrapper_leads_data`

User-saved Lead Manager rows in `leadscrapper_leads_data` (real `UserEmail`) are kept — they're separate from the cache and serve a different purpose.

## Rollback plan

If anything goes wrong after PHP cutover:

1. **Revert PHP** — `git checkout <previous-commit> -- lib/credits.php lib/supabase_cache.php apify-proxy.php` then redeploy.
2. **Old tables are still there.** They never stopped being written to (we haven't dropped them yet).
3. **Data loss check** — anything written to `user_leadscrapper_leads` during the cutover window can be replayed back into the old tables using a reverse INSERT-SELECT if needed.

The new tables can be dropped without affecting the old system:

```sql
DROP TABLE IF EXISTS user_leadscrapper_leads;
DROP TABLE IF EXISTS customer_lookup;
DROP SEQUENCE IF EXISTS customer_id_seq;
```

## Files

- `migrations/001_two_table_redesign.sql` — creates new tables, copies data
- `migrations/002_drop_old_tables.sql` — final cleanup after PHP cutover

## Decision log

- **Devs get IDs 1 and 2 (not 1001+):** Sir's request — keeps dev accounts visually distinct.
- **Real users start at 1001:** Sir's request — looks more like "real customer numbers" in invoices.
- **Email kept on `user_leadscrapper_leads`:** Sir's request — easier browsing in Supabase Table Editor. Denormalized but tiny cost.
- **Saved-leads stay in `leadscrapper_leads_data`:** Sir's confirmation — Table 1 holds scraped pool + user-saved leads under their real email. Table 2 holds delivered/queued/search state only.
