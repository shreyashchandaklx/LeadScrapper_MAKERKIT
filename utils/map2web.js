// Map2Web client — generates Basic/Gold/Premium sites from an Apify place row
// by calling /api/map2web/* on app.pixnom.com with session cookies.
//
// Pipeline (mirrors the Map2Web UI flow):
//   1) For each tier (1,2,3) call /api/map2web/build with the business object
//      → returns { filePath, html, repoName }
//   2) For each tier call /api/map2web/publish with { repoName, filePath, html }
//   3) /api/map2web/log records the three final tier URLs and the user.
//
// We skip /api/map2web/scrape: our Apify data already has the same shape the
// scrape endpoint returns, so we just pass it straight into /build.

// All Map2Web calls go through our same-origin PHP reverse proxy
// (map2web-proxy.php). The proxy forwards to app.pixnom.com with a shared
// service token, so the browser never has to deal with CORS or cross-domain
// cookies.

const TIERS = [
  { n: 1, folder: 'basic',   templateFileName: 'general-tier1.js' },
  { n: 2, folder: 'gold',    templateFileName: 'general-tier2.js' },
  { n: 3, folder: 'premium', templateFileName: 'general-tier3.js' },
];

async function callMap2Web(endpoint, body) {
  // endpoint is one of: scrape, deduct, build, publish, log
  const res = await fetch(`/map2web-proxy.php?path=${encodeURIComponent(endpoint)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(`Map2Web ${endpoint}: ${msg}`);
    err.status = res.status;
    err.detail = json || text;
    throw err;
  }
  return json;
}

// Convert an Apify "place" (or our stored lead._raw shape) into the business
// object Map2Web expects. Map2Web's /scrape returns this exact shape, so any
// field we don't have we leave as null/[] — the build templates are defensive.
export function placeToBusiness(p) {
  if (!p) return null;
  // Already in Map2Web shape (camelCase keys)
  if (p.placeId && p.title) return p;
  return null;
}

/**
 * Generate Basic + Gold + Premium sites for one lead.
 *
 * @param {object} business  Apify place object (camelCase keys: title, address, phone, placeId, etc.)
 * @param {object} opts
 * @param {string} opts.userEmail        Email to log against the user (defaults to logged-in session).
 * @param {string} [opts.mapsLink]       Optional shareable Google Maps short link for logging.
 * @param {(stage:string, tier?:number)=>void} [opts.onProgress]  Progress callback.
 * @returns {Promise<{ tier1:string, tier2:string, tier3:string, repoName:string }>}
 */
export async function generateSitesForBusiness(business, opts = {}) {
  if (!business || !business.title) throw new Error('business.title required');
  const onProgress = opts.onProgress || (() => {});

  // ── Build all three tiers ────────────────────────────────────────────────
  const builds = [];
  for (const t of TIERS) {
    onProgress('build', t.n);
    const b = await callMap2Web('build', {
      business,
      aiContent: null,
      templateFileName: t.templateFileName,
    });
    if (!b?.filePath || !b?.html || !b?.repoName) {
      throw new Error(`build tier${t.n} missing fields (filePath/html/repoName)`);
    }
    builds.push({ ...t, ...b });
  }

  const repoName = builds[0].repoName;

  // ── Publish each tier to GitHub Pages ────────────────────────────────────
  for (const b of builds) {
    onProgress('publish', b.n);
    await callMap2Web('publish', {
      repoName: b.repoName,
      filePath: b.filePath,
      html:     b.html,
    });
  }

  // Generate the final URLs based on the filePath returned by the server
  const tierUrls = {};
  builds.forEach(b => {
    tierUrls[`tier${b.n}`] = `https://pixnomofficial.github.io/map2web/${b.filePath}`;
  });

  const { tier1, tier2, tier3 } = tierUrls;

  // ── Log to Map2Web history (best-effort) ─────────────────────────────────
  onProgress('log');
  try {
    await callMap2Web('log', {
      email:       opts.userEmail || '',
      name:        business.title,
      phone:       business.phone || '',
      address:     business.address || '',
      mapsLink:    opts.mapsLink || business.url || '',
      businessType: 'general',
      tier:         'all',
      basicUrl:    tier1,
      goldUrl:     tier2,
      premiumUrl:  tier3,
    });
  } catch (e) {
    // History logging is non-critical — surface but don't fail the whole run.
    console.warn('[map2web] log failed (non-fatal):', e.message);
  }

  return { tier1, tier2, tier3, repoName };
}
