/**
 * utils/errorLogger.js
 *
 * Frontend error logger for Lead Scrapper (app "LS").
 * Generates a short Error ID locally (instant, works offline), shows it to the
 * user via the caller, and fire-and-forgets the full report to error-log.php
 * which writes it to logs/errors-YYYY-MM-DD.log on the server.
 *
 * Usage:
 *   import { logError, MODULES } from './utils/errorLogger.js';
 *   try { ... } catch (err) {
 *     const errorId = logError(MODULES.LEAD, err, {
 *       user: userEmail, component: 'LeadSearch', action: 'startScraping',
 *       context: { searchString },
 *     });
 *     setError(`Something went wrong. Error ID: ${errorId}`);
 *   }
 *
 * If a backend proxy response already carries an errorId (it logged the error
 * server-side), display THAT id instead of calling logError — one error, one ID.
 * Helper: extractErrorId(responseJson) below.
 */

export const MODULES = Object.freeze({
  LEAD: 'LEAD', // Lead Search / Apify scraping
  MGR:  'MGR',  // Lead Manager (saved leads)
  RPT:  'RPT',  // Report Generator / PDF
  BILL: 'BILL', // Credits / billing
  GEN:  'GEN',  // everything else / unknown
});

const APP = 'LS';
const VALID_MODULES = new Set(Object.values(MODULES));

function isLocalhost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

function getEndpoint() {
  const base = isLocalhost() ? 'http://localhost:8000' : window.location.origin;
  return `${base}/error-log.php`;
}

/** ERR-LS-<MODULE>-<TIME36>-<RAND4> — same shape as lib/error_logger.php */
export function generateErrorId(module) {
  const mod = VALID_MODULES.has(module) ? module : MODULES.GEN;
  const time36 = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `ERR-${APP}-${mod}-${time36}-${rand}`;
}

/** Pull a backend-generated errorId out of a proxy JSON response, if any. */
export function extractErrorId(json) {
  return (json && typeof json.errorId === 'string' && json.errorId.startsWith('ERR-'))
    ? json.errorId
    : null;
}

/* Dedupe guard: identical messages within 60s are sent once, then skipped. */
const recent = new Map(); // message -> { count, firstTs }
const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAX = 5;

function isDuplicate(message) {
  const now = Date.now();
  const entry = recent.get(message);
  if (!entry || now - entry.firstTs > DEDUPE_WINDOW_MS) {
    recent.set(message, { count: 1, firstTs: now });
    // keep map small
    if (recent.size > 50) {
      for (const [k, v] of recent) {
        if (now - v.firstTs > DEDUPE_WINDOW_MS) recent.delete(k);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > DEDUPE_MAX;
}

/**
 * Log an error. Returns the Error ID synchronously — show it to the user.
 *
 * @param {string} module  one of MODULES.*
 * @param {Error|string} error
 * @param {{user?:string,page?:string,component?:string,action?:string,context?:object,errorId?:string}} opts
 * @returns {string} errorId
 */
export function logError(module, error, opts = {}) {
  const mod = VALID_MODULES.has(module) ? module : MODULES.GEN;
  const message = (error && error.message) ? String(error.message) : String(error ?? 'Unknown error');
  const stack = (error && error.stack) ? String(error.stack) : '';
  const errorId = opts.errorId || generateErrorId(mod);

  // Always log to console for dev visibility, even when deduped/offline
  console.error(`[${errorId}]`, error);

  if (isDuplicate(`${mod}:${message}`)) return errorId;

  try {
    const payload = JSON.stringify({
      errorId,
      module: mod,
      message: message.slice(0, 2048),
      stack: stack.slice(0, 4096),
      user: opts.user || 'anonymous',
      page: opts.page || (window.location.pathname + window.location.hash),
      component: opts.component || '',
      action: opts.action || '',
      context: opts.context || {},
    });
    // fire-and-forget; keepalive lets it survive page unloads
    fetch(getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => { /* best effort — never disturb the UI */ });
  } catch {
    /* never let logging throw */
  }
  return errorId;
}

/**
 * Install window-level catch-alls (call once from app.jsx).
 * Anything that escapes component-level handling lands here as GEN.
 */
export function installGlobalErrorHandlers(getUser) {
  window.addEventListener('error', (event) => {
    logError(MODULES.GEN, event.error || event.message, {
      user: typeof getUser === 'function' ? (getUser() || 'anonymous') : 'anonymous',
      component: 'window',
      action: 'uncaught-error',
      context: { filename: event.filename || '', lineno: event.lineno || 0 },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason : String(event.reason ?? 'Unhandled rejection');
    logError(MODULES.GEN, reason, {
      user: typeof getUser === 'function' ? (getUser() || 'anonymous') : 'anonymous',
      component: 'window',
      action: 'unhandled-rejection',
    });
  });
}
