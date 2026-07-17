// Map2Web client — generates Basic/Gold/Premium sites from an Apify place row
// by calling /api/map2web/* on app.pixnom.com with session cookies.
//
// Pipeline (mirrors the Map2Web UI flow):
//   1) For each tier (basic, gold) call /api/map2web/build with the business
//      object + chosen template → returns { filePath, html, repoName }
//   2) For each tier call /api/map2web/publish with { repoName, filePath, html }
//   3) /api/map2web/log records the two final tier URLs and the user.
//
// The template is chosen from the lead's category (see resolveTemplateBase):
// a niche match uses the matching industry template, otherwise it falls back to
// the data-driven "general" template.
//
// We skip /api/map2web/scrape: our Apify data already has the same shape the
// scrape endpoint returns, so we just pass it straight into /build.

// All Map2Web calls go through our same-origin PHP reverse proxy
// (map2web-proxy.php). The proxy forwards to app.pixnom.com with a shared
// service token, so the browser never has to deal with CORS or cross-domain
// cookies.

// Two sites are produced per lead, each from a different design collection on
// the server:
//   tier 1 → "basic" → Niche_Templates_1   (underscored filenames)
//   tier 2 → "gold"  → Niche_Templates_2   (kebab-cased filenames)
// The server resolves the folder + filename casing from the `tier` we send, so
// here we only need the bare template basename (underscored, no extension).
const TIERS = [
  { n: 1, tier: 'basic' },
  { n: 2, tier: 'gold' },
];

// ── Category → niche-template matching ──────────────────────────────────────
// The server ships 37 niche templates (electricians, plumbing, solar_installers,
// …). We map a lead's Google category to the closest niche; anything we can't
// place falls back to the data-driven general template ('general').
//
// Rules are checked in order — first keyword hit wins — so more specific
// keywords ("real estate investor") must come before broader ones ("real
// estate"). Each value is the niche template basename (underscored, no .js).
const NICHE_RULES = [
  [['appliance repair', 'appliance'], 'appliance_repair'],
  [['chimney'], 'chimney_services'],
  [['commercial cleaning', 'janitorial', 'office cleaning'], 'commercial_cleaning_services'],
  [['concrete', 'cement', 'masonry'], 'concrete'],
  [['deck', 'patio'], 'deck_patio_builders'],
  [['drain'], 'drain_cleaning'],
  [['electric'], 'electricians'],
  [['fence', 'fencing'], 'fence'],
  [['floor', 'tile', 'carpet'], 'flooring'],
  [['garage door'], 'garage_doors'],
  [['glass', 'window repair', 'windshield'], 'glass_repair_installation'],
  [['gutter'], 'gutter_installation_cleaning'],
  [['handyman'], 'handyman_services'],
  [['home builder', 'custom home'], 'home_builders'],
  [['hvac', 'heating', 'air conditioning', 'furnace'], 'hvac'],
  [['insulation'], 'insulation_contractors'],
  [['irrigation', 'sprinkler'], 'irrigation_sprinkler_companies'],
  [['junk', 'hauling'], 'junk_removal'],
  [['kitchen', 'bathroom', 'remodel'], 'kitchen_bathroom_remodeling'],
  [['landscap', 'lawn', 'garden'], 'landscapers'],
  [['moving', 'mover', 'relocation'], 'moving_companies'],
  [['paint'], 'painters'],
  [['pest', 'exterminator', 'termite'], 'pest_control'],
  [['plumb'], 'plumbing'],
  [['pressure wash', 'power wash'], 'pressure_washing'],
  [['property management'], 'property_management'],
  [['real estate developer', 'real estate development'], 'real_estate_developers'],
  [['real estate investor', 'real estate investing', 'we buy houses'], 'real_estate_investors'],
  [['roof'], 'roofing'],
  [['siding'], 'siding_contractors'],
  [['solar'], 'solar_installers'],
  [['travel agency', 'travel agent'], 'travel_agency'],
  [['tree service', 'tree removal', 'arborist'], 'tree_service'],
  [['water damage', 'fire damage', 'restoration'], 'water_fire_restoration'],
  [['waterproof'], 'waterproofing_contractors'],
  [['window', 'door'], 'window_door_companies'],
  // Broad real-estate catch-all — keep AFTER the specific investor/developer
  // rules above so those win first.
  [['real estate', 'realtor', 'realty'], 'property_management'],
  // Broad construction catch-all — after the specific trades above.
  [['general contractor', 'contractor', 'construction', 'home improvement', 'remodeling'], 'general_contractors'],
];

/**
 * Resolve a lead's category to a niche template basename, or 'general' when no
 * niche matches. Returns the underscored basename WITHOUT the .js extension —
 * the server maps casing/folder from the tier we send.
 *
 * @param {string} category  e.g. "Electrician", "Solar energy company"
 * @returns {string} niche basename or 'general'
 */
export function resolveTemplateBase(category) {
  const c = String(category || '').toLowerCase().trim();
  if (!c) return 'general';
  for (const [keywords, template] of NICHE_RULES) {
    if (keywords.some((kw) => c.includes(kw))) return template;
  }
  return 'general';
}

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

  // Pick the template from the lead's category. A niche match (e.g.
  // "electricians") uses the matching industry template; no match falls back to
  // the data-driven "general" template. Same basename for both tiers — the
  // server resolves the per-tier folder + filename casing.
  const templateBase = resolveTemplateBase(business.categoryName || business.category);
  const templateFileName = `${templateBase}.js`;

  // ── Build filePath from business title (slug) ─────────────────────────────
  // The build endpoint only returns { html } — we derive filePath client-side.
  const slug = business.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const repoName = 'map2web-v2';

  // ── Build both tiers (basic + gold) ──────────────────────────────────────
  const builds = [];
  for (const t of TIERS) {
    onProgress('build', t.n);
    const b = await callMap2Web('build', {
      business,
      aiContent: null,
      templateFileName,
      tier: t.tier,
    });
    if (!b?.html) {
      throw new Error(`build tier${t.n} missing html`);
    }
    const filePath = t.tier === 'gold' ? `${slug}/gold.html` : `${slug}/index.html`;
    builds.push({ ...t, html: b.html, filePath, repoName });
  }

  // ── Publish each tier to GitHub Pages ────────────────────────────────────
  for (const b of builds) {
    onProgress('publish', b.n);
    await callMap2Web('publish', {
      repoName: b.repoName,
      filePath: b.filePath,
      html:     b.html,
    });
  }

  // Generate the final URLs based on the filePath
  const tierUrls = {};
  builds.forEach(b => {
    tierUrls[`tier${b.n}`] = `https://pixnomofficial.github.io/${repoName}/${b.filePath}`;
  });

  const { tier1, tier2 } = tierUrls;

  // ── Log to Map2Web history (best-effort) ─────────────────────────────────
  onProgress('log');
  try {
    await callMap2Web('log', {
      email:       opts.userEmail || '',
      name:        business.title,
      phone:       business.phone || '',
      address:     business.address || '',
      mapsLink:    opts.mapsLink || business.url || '',
      businessType: templateBase,
      tier:         'all',
      basicUrl:    tier1,
      goldUrl:     tier2,
      premiumUrl:  '',
    });
  } catch (e) {
    // History logging is non-critical — surface but don't fail the whole run.
    console.warn('[map2web] log failed (non-fatal):', e.message);
  }

  return { tier1, tier2, templateBase, repoName };
}
