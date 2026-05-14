const CACHE_KEY = 'email_extract_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const cache = JSON.parse(raw);
    const now = Date.now();
    // Prune expired entries
    for (const key of Object.keys(cache)) {
      if (now - cache[key].ts > CACHE_TTL) delete cache[key];
    }
    return cache;
  } catch {
    return {};
  }
}

function setCache(domain, emails) {
  const cache = getCache();
  cache[domain] = { emails, ts: Date.now() };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full, ignore */ }
}

function getCachedEmails(domain) {
  const cache = getCache();
  const entry = cache[domain];
  if (entry && Date.now() - entry.ts < CACHE_TTL) {
    return entry.emails;
  }
  return null;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Returns the extract-email.php endpoint URL.
 * On production: same-origin. On localhost: uses production endpoint.
 */
export function getExtractEmailUrl() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    // Use production endpoint from localStorage settings, or try same-origin (will fail gracefully)
    const settings = (() => { try { return JSON.parse(localStorage.getItem('appSettings') || '{}'); } catch { return {}; } })();
    if (settings.productionUrl) return `${settings.productionUrl.replace(/\/$/, '')}/extract-email.php`;
    return null;
  }
  return `${window.location.origin}/extract-email.php`;
}

/**
 * Extracts emails from a website URL via the PHP endpoint.
 * Returns { emails: string[], source: string } or { emails: [], source: '' } on failure.
 */
export async function extractEmailForUrl(url) {
  if (!url || url.length < 5) return { emails: [], source: '' };

  const domain = getDomain(url);

  // Check cache first
  const cached = getCachedEmails(domain);
  if (cached !== null) {
    return { emails: cached, source: 'cache' };
  }

  const endpoint = getExtractEmailUrl();
  if (!endpoint) return { emails: [], source: '' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const emails = data.success ? (data.emails || []) : [];
    const source = data.source || '';

    // Cache the result (even empty — avoids re-scraping)
    setCache(domain, emails);

    return { emails, source };
  } catch {
    // On failure, cache empty to avoid retrying immediately
    setCache(domain, []);
    return { emails: [], source: '' };
  }
}
