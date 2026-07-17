# City Scrape Progress Bar Bug — Fixed

**Date**: 2026-06-25
**Session**: Diagnosis + Fix

## Problem
"Scrape Whole City" showed a progress bar briefly then returned to the default empty state with no leads.

## Root Cause
`zips_total` mismatch between the `create` response and the first `status` poll tick.

- `cs_enqueue_zips()` returns the correct `zipsTotal` to the frontend, but its `sb_update()` to persist `zips_total` to the DB can fail silently (no error check).
- The status endpoint reads `(int)$job['zips_total']` from the DB — returns `0` if the update failed or the job row was reused stale.
- First poll tick (6s after create) gets `zipsTotal: 0` from status.
- Frontend termination condition: `(st.zipsDone + st.zipsFailed) >= st.zipsTotal` → `(0 + 0) >= 0` = **true** → polling resolves → `finally` → `setLoading(false)` → progress bar vanishes.

## Fix (two changes)

### 1. Backend — `city-scrape-proxy.php` (status endpoint, ~line 125)
Added guard: if `zips_total` is 0 but the job is still active, recompute from ZIP rows via `cs_refresh_job_counters()` before returning.

### 2. Frontend — `components/LeadSearch.jsx` (line 627)
Changed termination condition from:
```js
(st.zipsDone + st.zipsFailed) >= st.zipsTotal
```
to:
```js
(st.zipsTotal > 0 && (st.zipsDone + st.zipsFailed) >= st.zipsTotal)
```
This prevents premature termination even if the backend guard is bypassed.

## Files Modified
- `city-scrape-proxy.php` — status endpoint
- `components/LeadSearch.jsx` — polling termination condition

## How to Verify
1. Trigger a whole-city scrape for a small city (2-3 ZIPs)
2. Progress bar should remain visible until worker completes
3. Browser Network tab: first `?action=status` tick should return `zipsTotal > 0`
4. Leads should populate as worker finishes each ZIP

## Follow-up (optional)
- Add error check on `sb_update` in `cs_enqueue_zips()` to log failures explicitly
- Consider adding a `zips_total` Sanity check: if `count($cntRes['json']) > 0` but `$total === 0`, that's a bug
