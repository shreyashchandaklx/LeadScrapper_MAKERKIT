/**
 * utils/activityLogger.js
 *
 * Frontend USER-ACTIVITY logger for Lead Scrapper (app "LS").
 * Fire-and-forgets a small event to activity-log.php, which appends one JSON
 * line to logs/YYYY-MM-DD/activity.log on the server.
 *
 * Sibling of utils/errorLogger.js — but with NO global hooks (activity is
 * explicit, not caught) and NO returned id (activity isn't shown to the user).
 *
 * Usage:
 *   import { logActivity, EVENTS } from './utils/activityLogger.js';
 *   logActivity(EVENTS.EXPORT, { count: rows, meta: { source: 'search' }, user: userEmail });
 *
 * Backend events (search / city_search) are logged server-side in apify-proxy.php
 * where the count is authoritative — do NOT also log those here.
 */

export const EVENTS = Object.freeze({
  SEARCH:        'search',         // single search (usually logged backend-side)
  CITY_SEARCH:   'city_search',   // whole-city scrape completed (frontend summary)
  EXPORT:        'export',         // CSV / sheet export
  REPORT:        'report',         // PDF report generated
  EMAIL_WRITTEN: 'email_written',  // AI email generated for a lead
  LOGIN:         'login',          // session start
  OTHER:         'other',
});

const VALID_EVENTS = new Set(Object.values(EVENTS));

function isLocalhost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

function getEndpoint() {
  const base = isLocalhost() ? 'http://localhost:8000' : window.location.origin;
  return `${base}/activity-log.php`;
}

/**
 * Log a user-activity event. Fire-and-forget — never blocks or throws.
 *
 * @param {string} event one of EVENTS.*
 * @param {{count?:number, meta?:object, user?:string, page?:string}} opts
 */
export function logActivity(event, opts = {}) {
  const ev = VALID_EVENTS.has(event) ? event : EVENTS.OTHER;
  try {
    const payload = JSON.stringify({
      event: ev,
      count: Number.isFinite(opts.count) ? opts.count : 0,
      meta: opts.meta || {},
      user: opts.user || 'anonymous',
      page: opts.page || (window.location.pathname + window.location.hash),
    });
    fetch(getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true, // survive page unloads (e.g. login → navigate)
    }).catch(() => { /* best effort — never disturb the UI */ });
  } catch {
    /* never let logging throw */
  }
}
