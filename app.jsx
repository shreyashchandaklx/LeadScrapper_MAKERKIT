import React, { useState, useCallback, useMemo, useEffect, useRef, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { generateLeads, generateEmails, generateReports } from './utils/mockData.js';
// Eagerly loaded — part of the initial shell / first paint.
import { Sidebar } from './components/Sidebar.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import TopNavbar from './components/TopNavbar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { logError, MODULES, installGlobalErrorHandlers } from './utils/errorLogger.js';
import { logActivity, EVENTS } from './utils/activityLogger.js';

// Lazily loaded — each becomes its own Rollup chunk so the heavy libraries they
// pull in (LeadSearch → country-state-city ~7.7MB + zipcodes; ReportGenerator →
// jspdf + html2canvas) only download the first time that page is opened, instead
// of bloating the initial bundle and causing the white-screen-on-load.
const LeadSearch      = lazy(() => import('./components/LeadSearch.jsx'));
const LeadDetail      = lazy(() => import('./components/LeadDetail.jsx').then(m => ({ default: m.LeadDetail })));
const LeadManager     = lazy(() => import('./components/LeadManager.jsx').then(m => ({ default: m.LeadManager })));
const EmailGenerator  = lazy(() => import('./components/EmailGenerator.jsx').then(m => ({ default: m.EmailGenerator })));
const ReportGenerator = lazy(() => import('./components/ReportGenerator.jsx').then(m => ({ default: m.ReportGenerator })));
const ReviewResponder = lazy(() => import('./components/ReviewResponder.jsx').then(m => ({ default: m.ReviewResponder })));
const PostCreator     = lazy(() => import('./components/PostCreator.jsx').then(m => ({ default: m.PostCreator })));
const EmailOutreach   = lazy(() => import('./components/EmailOutreach.jsx').then(m => ({ default: m.EmailOutreach })));
const Settings        = lazy(() => import('./components/Settings.jsx').then(m => ({ default: m.Settings })));

/* ─── Supabase-backed storage (via leads-proxy.php) ─── */
function isLocalhost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

function getLeadsProxyUrl() {
  const base = isLocalhost()
    ? 'http://localhost:8000'
    : window.location.origin;
  return `${base}/leads-proxy.php`;
}

import { generateSitesForBusiness } from './utils/map2web.js';

// Reconstruct the Map2Web "business" object from our stored lead. Prefers
// the raw Apify fields we stash during search, falls back to whatever
// camelCase fields the lead carries.
function leadToBusiness(lead) {
  const raw = lead?._raw || {};
  const parseMaybe = (v) => {
    if (Array.isArray(v) || (v && typeof v === 'object')) return v;
    if (typeof v === 'string' && v.length) { try { return JSON.parse(v); } catch { } }
    return null;
  };
  // Build a Map2Web-shaped business object. Unknown fields stay null/[] so
  // the build templates' optional-chains don't choke.
  return {
    title: raw.Title || lead.business_name || '',
    subTitle: null,
    description: raw.Description || lead.description || null,
    price: raw.Price || lead.price_level || null,
    categoryName: raw.CategoryName || lead.category || '',
    categories: Array.isArray(lead.all_categories) ? lead.all_categories : [],
    address: raw.Address || lead.address || '',
    neighborhood: raw.Neighborhood || lead.neighborhood || null,
    street: raw.Street || '',
    city: raw.City || lead.city || '',
    postalCode: raw.PostalCode || lead.postal_code || '',
    state: raw.State || lead.state || '',
    countryCode: raw.CountryCode || lead.country || '',
    phone: raw.Phone || lead.phone || '',
    phoneUnformatted: raw.PhoneUnformatted || '',
    claimThisBusiness: raw.ClaimThisBusiness === 'false' || raw.ClaimThisBusiness === false || lead.gbp_claimed === true,
    cid: raw.Cid || '',
    location: parseMaybe(raw.Location),
    totalScore: Number(raw.TotalScore ?? lead.rating ?? 0) || null,
    reviewsCount: Number(raw.ReviewsCount ?? lead.review_count ?? 0) || 0,
    imagesCount: Number(raw.ImagesCount ?? lead.images_count ?? 0) || 0,
    imageCategories: parseMaybe(raw.ImageCategories) || [],
    peopleAlsoSearch: parseMaybe(raw.PeopleAlsoSearch) || [],
    placesTags: parseMaybe(raw.PlacesTags) || [],
    reviewsTags: parseMaybe(raw.ReviewsTags) || [],
    gasPrices: parseMaybe(raw.GasPrices) || [],
    googleFoodUrl: raw.GoogleFoodUrl || null,
    hotelAds: parseMaybe(raw.HotelAds) || [],
    openingHours: parseMaybe(raw.OpeningHours) || [],
    url: raw.Url || lead.maps_url || '',
    searchPageUrl: raw.SearchPageUrl || '',
    searchString: raw.SearchString || '',
    language: raw.Language || 'en',
    rank: Number(raw.Rank ?? 0) || 0,
    isAdvertisement: raw.IsAdvertisement === true || raw.IsAdvertisement === 'true' || lead.is_advertinement === true,
    imageUrl: raw.ImageUrl || '',
    kgmid: raw.Kgmid || '',
    website: raw.Website || lead.website || '',
    additionalInfo: parseMaybe(raw.AdditionalInfo) || null,
    reviewsDistribution: parseMaybe(raw.ReviewsDistribution) || null,
    additionalOpeningHours: parseMaybe(raw.AdditionalOpeningHours) || null,
    locatedIn: raw.LocatedIn || null,
    placeId: raw.PlaceId || lead.place_id || lead.id || '',
    permanentlyClosed: lead.permanently_closed === true,
    temporarilyClosed: false,
    inputStartUrl: lead.maps_url || raw.Url || '',
    scrapedAt: lead.created_at || new Date().toISOString(),
  };
}

/* Generate Basic + Gold sites for ONE lead via Map2Web. Returns {tier1,tier2,templateBase} or throws. */
async function generateSiteForLead(lead, onStage) {
  const email = getUserEmail();
  if (!email) throw new Error('no logged-in email');
  const business = leadToBusiness(lead);
  if (!business.title) throw new Error('lead is missing title — cannot build site');
  return await generateSitesForBusiness(business, {
    userEmail: email,
    mapsLink: lead.maps_url || business.url || '',
    onProgress: onStage || (() => { }),
  });
}

// Persist generated tier URLs back to Supabase via the existing leads-proxy.
async function persistTiersToSupabase(placeId, urls) {
  const email = getUserEmail();
  if (!email || !placeId) return false;
  try {
    const res = await fetch(getLeadsProxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateLead',
        UserEmail: email,
        PlaceId: placeId,
        // Only write the tiers we actually generated (basic + gold). Tier3 is
        // no longer produced — omit it so any existing value is preserved
        // rather than blanked out.
        fields: {
          Tier1: urls.tier1 || '',
          Tier2: urls.tier2 || '',
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) {
      console.warn('[persistTiers] failed', res.status, j);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[persistTiers] exception', e);
    return false;
  }
}

function getUserEmail() {
  // In embed mode, the parent Makerkit page passes the email via URL param.
  // ALWAYS prefer the URL param so switching accounts works correctly.
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlEmail = (params.get('email') || '').toLowerCase().trim();
    if (urlEmail) {
      localStorage.setItem('loggedInUser', urlEmail);
      return urlEmail;
    }
  }
  // Fallback to localStorage (standalone mode)
  const stored = (localStorage.getItem('loggedInUser') || '').toLowerCase().trim();
  return stored;
}

// Catch-all for anything that escapes component-level handling (logged as GEN)
installGlobalErrorHandlers(getUserEmail);

/* ─── Storage API (Supabase via leads-proxy.php) ─── */

async function sheetsLoad(email) {
  try {
    const url = `${getLeadsProxyUrl()}?action=load&email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    if (!res.ok) { console.error('sheetsLoad HTTP error', res.status); return null; }
    const data = await res.json();
    if (!data.success) { console.error('sheetsLoad API error', data); return null; }
    return data;
  } catch (err) { console.error('sheetsLoad exception', err); return null; }
}

// Paged variant — fetches one window of leads (limit/offset). Used to stream
// leads in progressively so the first ~20 appear fast instead of blocking the
// UI on the full set.
async function sheetsLoadPage(email, offset, limit) {
  try {
    const url = `${getLeadsProxyUrl()}?action=load&email=${encodeURIComponent(email)}`
      + `&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) { console.error('sheetsLoadPage HTTP error', res.status); return null; }
    const data = await res.json();
    if (!data.success) { console.error('sheetsLoadPage API error', data); return null; }
    return data;
  } catch (err) { console.error('sheetsLoadPage exception', err); return null; }
}

async function sheetsPost(action, payload) {
  const email = getUserEmail();
  const payloadSummary = action === 'bulkSaveLeads'
    ? { count: (payload.leads || []).length, firstId: (payload.leads || [])[0]?.PlaceId }
    : Object.keys(payload);
  console.log('[sheetsPost]', action, 'email:', email || '(EMPTY)', 'payload:', payloadSummary);
  if (!email) {
    console.error('[sheetsPost] BLOCKED — no email in localStorage. localStorage keys:', Object.keys(localStorage));
    alert(`Cannot save: no logged-in email found.\n\naction: ${action}\nlocalStorage.loggedInUser is empty.\nIf running embedded, the parent page must pass ?email=... in the URL.`);
    return;
  }
  try {
    const url = getLeadsProxyUrl();
    console.log('[sheetsPost] POST', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, UserEmail: email, ...payload }),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { }
    console.log('[sheetsPost] response status:', res.status, 'body:', json);
    if (!res.ok) {
      console.error('[sheetsPost] HTTP error:', res.status, json, 'raw:', text.slice(0, 500));
      // 5xx responses carry the backend's errorId (leads-proxy logged it);
      // for anything else show/log a frontend one so the user always has an ID.
      const errorId = json.errorId
        || logError(MODULES.MGR, `Save failed (${res.status}): ${json.error || text.slice(0, 200)}`, {
             user: email, component: 'app', action,
           });
      alert(`Save failed (${res.status}): ${json.error || text.slice(0, 200)}\n\ndetail: ${json.detail ? String(json.detail).slice(0, 200) : '(none)'}\n\nError ID: ${errorId}`);
    } else if (!json.success) {
      console.error('[sheetsPost] API error:', json);
      const errorId = json.errorId
        || logError(MODULES.MGR, `Save failed: ${json.error}`, { user: email, component: 'app', action });
      alert(`Save failed: ${json.error}\n\nError ID: ${errorId}`);
    } else {
      console.log('[sheetsPost] SUCCESS', json);
    }
  } catch (err) {
    console.error('[sheetsPost] EXCEPTION:', err);
    const errorId = logError(MODULES.MGR, err, { user: email, component: 'app', action });
    alert(`Save error: ${err.message}\n\nError ID: ${errorId}`);
  }
}

async function sheetsPostSilent(action, payload) {
  const email = getUserEmail();
  const payloadSummary = action === 'bulkSaveLeads'
    ? { count: (payload.leads || []).length, firstId: (payload.leads || [])[0]?.PlaceId }
    : Object.keys(payload);
  console.log('[sheetsPostSilent]', action, 'email:', email || '(EMPTY)', 'payload:', payloadSummary);
  if (!email) {
    console.error('[sheetsPostSilent] BLOCKED — no email in localStorage. localStorage keys:', Object.keys(localStorage));
    throw new Error(`Cannot save: no logged-in email found. action: ${action}`);
  }
  try {
    const url = getLeadsProxyUrl();
    console.log('[sheetsPostSilent] POST', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, UserEmail: email, ...payload }),
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { }
    console.log('[sheetsPostSilent] response status:', res.status, 'body:', json);
    if (!res.ok) {
      console.error('[sheetsPostSilent] HTTP error:', res.status, json, 'raw:', text.slice(0, 500));
      throw new Error(`Save failed (${res.status}): ${json.error || text.slice(0, 200)}`);
    } else if (!json.success) {
      console.error('[sheetsPostSilent] API error:', json);
      throw new Error(`Save failed: ${json.error}`);
    } else {
      console.log('[sheetsPostSilent] SUCCESS', json);
      return json;
    }
  } catch (err) {
    console.error('[sheetsPostSilent] EXCEPTION:', err);
    throw err;
  }
}

/* ─── Convert Sheet row → App lead object ─── */
function sheetRowToLead(row) {
  const parseMaybeJson = (v, fallback) => {
    if (Array.isArray(v) || (v && typeof v === 'object')) return v;
    if (typeof v === 'string' && v.length) {
      try { return JSON.parse(v); } catch { /* fallthrough */ }
    }
    return fallback;
  };

  const openingHoursArr = parseMaybeJson(row.OpeningHours, []);
  const openingHoursStr = Array.isArray(openingHoursArr)
    ? openingHoursArr.map(h => `${h.day}: ${h.hours}`).join(', ')
    : (row.OpeningHours || '');

  const issues = parseMaybeJson(row.Issues, []);

  const claimBiz = row.ClaimThisBusiness === 'false' || row.ClaimThisBusiness === false;
  const hasWebsite = !!row.Website && row.Website.length > 5;
  const hasSsl = hasWebsite && (row.Website || '').startsWith('https');
  const isAd = row.IsAdvertisement === true || row.IsAdvertisement === 'true';

  return {
    id: row.PlaceId || '',
    business_name: row.Title || '',
    address: row.Address || '',
    city: row.City || '',
    state: row.State || '',
    phone: row.Phone || '',
    email: row.ExtractedEmail || '',
    website: row.Website || '',
    category: row.CategoryName || '',
    rating: Number(row.TotalScore) || 0,
    review_count: Number(row.ReviewsCount) || 0,
    score: Number(row.LeadScore) || 0,
    status: row.Status || 'new',
    notes: row.Notes || '',
    source: 'Apify Google Maps',
    gbp_claimed: claimBiz,
    has_website: hasWebsite,
    mobile_responsive: hasWebsite && hasSsl,
    has_ssl: hasSsl,
    has_social: false,
    running_ads: isAd,
    three_pack_rank: (Number(row.Rank) <= 3) ? Number(row.Rank) : null,
    review_sentiment: 'none',
    issues: issues,
    created_at: row.CreatedAt || '',
    postal_code: row.PostalCode || '',
    country: row.CountryCode || '',
    neighborhood: row.Neighborhood || '',
    price_level: row.Price || '',
    description: row.Description || '',
    opening_hours: openingHoursStr,
    all_categories: [],
    maps_url: row.Url || '',
    place_id: row.PlaceId || '',
    images_count: Number(row.ImagesCount) || 0,
    permanently_closed: false,
    is_advertinement: isAd,
    follow_up_date: row.FollowUpDate || '',
    tier1: row.Tier1 || '',
    tier2: row.Tier2 || '',
    tier3: row.Tier3 || '',
    tier1_short: row.Tier1_short || '',
    tier2_short: row.Tier2_short || '',
    tier3_short: row.Tier3_short || '',
  };
}

/* ─── Convert App lead → Sheet row for saving ─── */
function leadToSheetRow(lead) {
  const raw = lead._raw || {};
  return {
    Title: raw.Title || lead.business_name || '',
    Price: raw.Price || lead.price_level || '',
    CategoryName: raw.CategoryName || lead.category || '',
    Address: raw.Address || lead.address || '',
    Neighborhood: raw.Neighborhood || lead.neighborhood || '',
    Street: raw.Street || '',
    City: raw.City || lead.city || '',
    PostalCode: raw.PostalCode || lead.postal_code || '',
    State: raw.State || lead.state || '',
    CountryCode: raw.CountryCode || lead.country || '',
    Phone: raw.Phone || lead.phone || '',
    PhoneUnformatted: raw.PhoneUnformatted || '',
    ClaimThisBusiness: raw.ClaimThisBusiness || (lead.gbp_claimed ? 'true' : 'false'),
    Cid: raw.Cid || '',
    Location: raw.Location || '',
    TotalScore: raw.TotalScore || lead.rating || 0,
    ReviewsCount: raw.ReviewsCount || lead.review_count || 0,
    ImagesCount: raw.ImagesCount || lead.images_count || 0,
    ImageCategories: raw.ImageCategories || '',
    PeopleAlsoSearch: raw.PeopleAlsoSearch || '',
    PlacesTags: raw.PlacesTags || '',
    ReviewsTags: raw.ReviewsTags || '',
    GasPrices: raw.GasPrices || '',
    GoogleFoodUrl: raw.GoogleFoodUrl || '',
    HotelAds: raw.HotelAds || '',
    OpeningHours: raw.OpeningHours || lead.opening_hours || '',
    Url: raw.Url || lead.maps_url || '',
    SearchPageUrl: raw.SearchPageUrl || '',
    SearchString: raw.SearchString || '',
    Language: raw.Language || '',
    Rank: raw.Rank || '',
    IsAdvertisement: raw.IsAdvertisement || (lead.is_advertinement ? 'true' : 'false'),
    ImageUrl: raw.ImageUrl || '',
    Kgmid: raw.Kgmid || '',
    Website: raw.Website || lead.website || '',
    AdditionalInfo: raw.AdditionalInfo || '',
    ReviewsDistribution: raw.ReviewsDistribution || '',
    AdditionalOpeningHours: raw.AdditionalOpeningHours || '',
    Description: raw.Description || lead.description || '',
    LocatedIn: raw.LocatedIn || '',
    PlaceId: raw.PlaceId || lead.place_id || lead.id || '',
    ExtractedEmail: lead.email || '',
    LeadScore: lead.score || 0,
    Status: lead.status || 'new',
    Notes: lead.notes || '',
    Issues: JSON.stringify(lead.issues || []),
    CreatedAt: lead.created_at || new Date().toISOString(),
    FollowUpDate: lead.follow_up_date || '',
  };
}

function sheetRowToEmail(row) {
  return {
    id: row.EmailId || '',
    lead_id: row.LeadId || '',
    lead_name: row.LeadName || '',
    from_email: row.FromEmail || '',
    to_email: row.ToEmail || '',
    subject: row.Subject || '',
    body: row.Body || '',
    sent_at: row.SentAt || '',
    status: row.Status || 'sent',
  };
}

function sheetRowToReport(row) {
  return {
    id: row.ReportId || '',
    lead_id: row.LeadId || '',
    lead_name: row.LeadName || '',
    created_at: row.CreatedAt || '',
    score: Number(row.Score) || 0,
  };
}

/* ─── App Component ─── */

const App = () => {
  const isEmbed = typeof window !== 'undefined' && window.__EMBED_MODE__ === true;
  const getInitialPage = () => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const p = params.get('page');
      if (p) return p;
    }
    return 'search';
  };
  const [page, setPage] = useState(getInitialPage);
  // Remember where we navigated to LeadDetail from, so its back button
  // returns to that page (Lead Manager / Find Leads / Dashboard) instead
  // of always landing on Find Leads.
  const [prevPage, setPrevPage] = useState('search');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [leads, setLeads] = useState([]);
  const [emails, setEmails] = useState([]);
  const [reports, setReports] = useState([]);
  // leadsLoading: leads are still streaming in from the backend (progressive
  // 20-at-a-time load). The app shell + Dashboard render immediately regardless;
  // only data-dependent views (Lead Manager) surface this as an inline state.
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [siteGen, setSiteGen] = useState({ active: false, completed: 0, total: 0, current: '', errors: [] });
  const [balance, setBalance] = useState(null);
  const initialLoadDone = useRef(false);
  const siteGenCancelRef = useRef(false);
  // Find Leads stays mounted (under display:none) once visited so its search
  // state survives navigation — but we don't mount it (and load its heavy chunk)
  // until the user actually opens it the first time.
  const visitedSearchRef = useRef(false);

  // Shared credit balance: navbar + LeadSearch both read this; LeadSearch triggers refresh after a charge.
  const refreshBalance = useCallback(async () => {
    const email = getUserEmail();
    if (!email) return;
    try {
      const base = isLocalhost() ? 'http://localhost:8000' : window.location.origin;
      const res = await fetch(`${base}/apify-proxy.php?action=balance&email=${encodeURIComponent(email)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.balance === 'number') setBalance(data.balance);
    } catch (err) {
      console.error('[refreshBalance] failed:', err);
    }
  }, []);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  // Log a 'login' activity once per browser session (per resolved email), so the
  // rollup can count daily active users without spamming a row on every remount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const email = getUserEmail();
    if (!email) return;
    try {
      const key = `leadscrapper:loginLogged:${email}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        logActivity(EVENTS.LOGIN, { user: email });
      }
    } catch { /* sessionStorage unavailable — skip */ }
  }, []);

  // When embedded in the Makerkit shell, listen for `setPage` messages from
  // the parent so clicking a sidebar link (even one pointing at the URL we're
  // already on) snaps the SPA back to that section. Without this, the iframe
  // can drift (e.g. into LeadDetail → back → Find Leads) while the parent URL
  // still says /lead-manager, and the sidebar's Lead Manager link would be a
  // no-op until the user navigated elsewhere first.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e) => {
      if (e.origin && e.origin !== 'https://app.pixnom.com') return;
      const data = e.data;
      if (!data || data.type !== 'leadscrapper:setPage' || typeof data.page !== 'string') return;
      setSelectedLeadId(null);
      setPage(data.page);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Generate sites for N leads sequentially via Map2Web. For each lead we run
  // build×3 → publish×3 → log, then persist tier URLs back to Supabase.
  const handleGenerateSites = useCallback(async (leadList) => {
    const queue = (leadList || []).filter(l => l && l.id);
    if (queue.length === 0) { alert('No leads selected.'); return; }
    if (!getUserEmail()) { alert('Login first — no email found.'); return; }
    // PostHog: track site generation start
    if (window.posthog) {
      posthog.capture('site_generation_started', { lead_count: queue.length });
    }
    siteGenCancelRef.current = false;
    setSiteGen({ active: true, completed: 0, total: queue.length, current: '', stage: '', errors: [] });
    let completed = 0;
    const errors = [];
    for (const lead of queue) {
      if (siteGenCancelRef.current) break;
      setSiteGen(s => ({ ...s, current: lead.business_name || lead.id, stage: 'build 1/2' }));
      try {
        const r = await generateSiteForLead(lead, (stage, tier) => {
          const label = stage === 'log' ? 'logging' : `${stage} ${tier}/2`;
          setSiteGen(s => ({ ...s, stage: label }));
        });
        // Update in-memory state immediately so the UI shows tier links.
        setLeads(prev => prev.map(l => l.id === lead.id ? {
          ...l,
          tier1: r.tier1 || l.tier1,
          tier2: r.tier2 || l.tier2,
        } : l));
        // Persist back to Supabase (non-blocking for the next lead).
        persistTiersToSupabase(lead.id, r);
      } catch (err) {
        console.error('[generateSite]', lead.id, err);
        errors.push({ id: lead.id, name: lead.business_name, error: err.message });
      }
      completed++;
      setSiteGen(s => ({ ...s, completed, errors }));
    }
    setSiteGen(s => ({ ...s, active: false, current: '', stage: '' }));
    if (errors.length > 0) {
      alert(`Site generation finished: ${completed - errors.length}/${queue.length} succeeded.\n\nErrors:\n${errors.slice(0, 5).map(e => `• ${e.name}: ${e.error}`).join('\n')}${errors.length > 5 ? `\n…and ${errors.length - 5} more` : ''}`);
    } else {
      alert(`✓ Generated ${completed} site${completed === 1 ? '' : 's'} successfully.`);
    }
  }, []);

  const handleCancelSiteGen = useCallback(() => { siteGenCancelRef.current = true; }, []);

  // Progressively load saved leads on mount. The app shell + Dashboard render
  // immediately; leads stream in 20-at-a-time so the first page appears fast and
  // the rest fill in the background. We do NOT block the whole UI on this.
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const loadEmail = getUserEmail();
    if (!loadEmail) {
      setLeadsLoading(false);
      return;
    }
    console.log('[sheetsLoad] email from storage:', loadEmail);

    const PAGE = 20;
    let cancelled = false;

    (async () => {
      let offset = 0;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const data = await sheetsLoadPage(loadEmail, offset, PAGE);
          if (cancelled) return;
          const rows = (data && data.success && Array.isArray(data.leads)) ? data.leads : [];
          if (rows.length > 0) {
            setLeads(prev => [...prev, ...rows.map(sheetRowToLead)]);
          }
          console.log(`[sheetsLoad] page offset=${offset} got ${rows.length}`);
          // A short page (or a failed/empty fetch) means we've reached the end.
          if (!data || !data.success || rows.length < PAGE) break;
          offset += PAGE;
        }
      } catch (err) {
        console.error('[sheetsLoad] catch', err);
        logError(MODULES.MGR, err, { user: getUserEmail(), component: 'app', action: 'load' });
      } finally {
        if (!cancelled) setLeadsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleLogout = useCallback(() => {
    if (window.appLogout) {
      window.appLogout();
    }
  }, []);

  const navigate = useCallback((p, leadId) => {
    if (leadId) setSelectedLeadId(leadId);
    setPage(prev => {
      if (p === 'detail' && prev !== 'detail') setPrevPage(prev);
      return p;
    });
  }, []);

  const handleViewDetail = useCallback((leadId) => {
    setSelectedLeadId(leadId);
    setPage(prev => {
      if (prev !== 'detail') setPrevPage(prev);
      return 'detail';
    });
  }, []);

  const handleSaveLead = useCallback((lead) => {
    setLeads(prev => {
      if (prev.find(l => l.id === lead.id)) return prev;
      const newLead = { ...lead, status: 'new' };
      sheetsPost('saveLead', { lead: leadToSheetRow(newLead) });
      return [...prev, newLead];
    });
  }, []);

  // Bulk save — one API call instead of N individual calls (avoids rate limiting)
  const handleBulkSaveLeads = useCallback((newLeads) => {
    setLeads(prev => {
      const existingIds = new Set(prev.map(l => l.id));
      const toAdd = newLeads
        .filter(l => !existingIds.has(l.id))
        .map(l => ({ ...l, status: 'new' }));
      if (toAdd.length === 0) { console.log('[bulkSave] nothing new to add'); return prev; }
      const rows = toAdd.map(leadToSheetRow);
      console.log('[bulkSave] saving', rows.length, 'leads via API', rows.map(r => r.PlaceId).join(', '));
      sheetsPost('bulkSaveLeads', { leads: rows });
      return [...prev, ...toAdd];
    });
  }, []);

  const handleUpdateStatus = useCallback((leadId, status) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
    sheetsPost('updateLead', { PlaceId: leadId, fields: { Status: status } });
  }, []);

  const handleUpdateNotes = useCallback((leadId, notes) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, notes } : l));
    sheetsPost('updateLead', { PlaceId: leadId, fields: { Notes: notes } });
  }, []);

  const handleDeleteLead = useCallback((leadId) => {
    setLeads(prev => prev.filter(l => l.id !== leadId));
    sheetsPost('deleteLead', { PlaceId: leadId });
  }, []);

  const handleGenerateEmail = useCallback((leadId) => {
    setSelectedLeadId(leadId);
    setPage('email-gen');
  }, []);

  // From LeadDetail: jump to the Reports page with this lead pre-selected
  // (was referenced at the LeadDetail render but never defined — ERR-LS-GEN-MQ69TGP0-FF3C)
  const handleGoToReport = useCallback((leadId) => {
    setSelectedLeadId(leadId);
    setPage('reports');
  }, []);

  const handleSendEmail = useCallback((leadId, subject, body, fromEmail, toEmail) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const newEmail = {
      id: `em_${Date.now()}`,
      lead_id: leadId,
      lead_name: lead.business_name,
      from_email: fromEmail || '',
      to_email: toEmail || lead.email || '',
      subject,
      body,
      sent_at: new Date().toISOString(),
      status: 'sent',
    };
    setEmails(prev => [newEmail, ...prev]);
    setLeads(prev => prev.map(l => l.id === leadId && l.status === 'new' ? { ...l, status: 'contacted' } : l));
    // Save to Sheets
    sheetsPost('saveEmail', {
      emailData: {
        EmailId: newEmail.id,
        LeadId: newEmail.lead_id,
        LeadName: newEmail.lead_name,
        FromEmail: newEmail.from_email,
        ToEmail: newEmail.to_email,
        Subject: newEmail.subject,
        Body: newEmail.body,
        SentAt: newEmail.sent_at,
        Status: newEmail.status,
      }
    });
    sheetsPost('updateLead', { PlaceId: leadId, fields: { Status: 'contacted' } });
    logActivity(EVENTS.EMAIL_WRITTEN, { user: getUserEmail(), count: 1, meta: { leadId, business: lead.business_name } });
    // PostHog: track email sent
    if (window.posthog) {
      posthog.capture('lead_email_sent', { leadId, business: lead.business_name });
    }
  }, [leads]);

  // Reports live in localStorage (the PHP proxy has no saveReport/deleteReport
  // actions — calling them produced the 400 "unknown action: saveReport"
  // alert sir was seeing). Key per user email so accounts don't collide.
  const reportsStorageKey = useCallback(() => {
    const email = getUserEmail();
    return email ? `leadscrapper:reports:${email}` : 'leadscrapper:reports:_anon';
  }, []);

  const persistReports = useCallback((rs) => {
    try { localStorage.setItem(reportsStorageKey(), JSON.stringify(rs)); }
    catch (e) { console.warn('[reports] persist failed', e); }
  }, [reportsStorageKey]);

  // Load any previously-saved reports for this user on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(reportsStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setReports(parsed);
      }
    } catch (e) { console.warn('[reports] load failed', e); }
  }, [reportsStorageKey]);

  const handleGenerateReport = useCallback((leadId) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const newReport = {
      id: `rpt_${Date.now()}`,
      lead_id: leadId,
      lead_name: lead.business_name,
      created_at: new Date().toISOString(),
      score: lead.score,
    };
    setReports(prev => {
      const next = [newReport, ...prev];
      persistReports(next);
      return next;
    });
    logActivity(EVENTS.REPORT, { user: getUserEmail(), count: 1, meta: { leadId, business: lead.business_name } });
    // PostHog: track report generated
    if (window.posthog) {
      posthog.capture('lead_report_generated', { leadId, business: lead.business_name });
    }
  }, [leads, persistReports]);

   const handleDeleteReport = useCallback((reportId) => {
     setReports(prev => {
       const next = prev.filter(r => r.id !== reportId);
       persistReports(next);
       return next;
     });
   }, [persistReports]);

  const selectedLead = useMemo(() => leads.find(l => l.id === selectedLeadId), [leads, selectedLeadId]);

  // Wrap a view in an ErrorBoundary so a crash in one module shows an Error ID
  // card instead of killing the whole app (module tag lands in the log file).
  const bounded = (module, componentName, node) => (
    <ErrorBoundary module={module} componentName={componentName} user={getUserEmail()}>
      {node}
    </ErrorBoundary>
  );

  // Fallback shown while a lazily-loaded route chunk is downloading.
  const chunkFallback = (
    <div className="flex items-center justify-center h-64">
      <div className="text-center space-y-3">
        <div className="loading loading-spinner loading-lg text-primary"></div>
        <p className="text-base-content/60 text-sm">Loading…</p>
      </div>
    </div>
  );

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return bounded(MODULES.GEN, 'Dashboard', <Dashboard leads={leads} emails={emails} reports={reports} onNavigate={navigate} />);
      case 'detail':
        if (!selectedLead) { setPage(prevPage); return null; }
        return bounded(MODULES.MGR, 'LeadDetail', <LeadDetail lead={selectedLead} onBack={() => setPage(prevPage)} onGenerateEmail={handleGenerateEmail} onGenerateReport={handleGoToReport} />);
      case 'leads':
        return bounded(MODULES.MGR, 'LeadManager', <LeadManager leads={leads} leadsLoading={leadsLoading} onViewDetail={handleViewDetail} onUpdateStatus={handleUpdateStatus} onUpdateNotes={handleUpdateNotes} onDeleteLead={handleDeleteLead} onGenerateEmail={handleGenerateEmail} onGenerateSites={handleGenerateSites} siteGen={siteGen} onCancelSiteGen={handleCancelSiteGen} />);
      case 'email-gen':
        return bounded(MODULES.GEN, 'EmailGenerator', <EmailGenerator leads={leads} selectedLeadId={selectedLeadId} onSendEmail={handleSendEmail} />);
       case 'reports':
         return bounded(MODULES.RPT, 'ReportGenerator', <ReportGenerator leads={leads} reports={reports} selectedLeadId={selectedLeadId} onGenerateReport={handleGenerateReport} onDeleteReport={handleDeleteReport} />);
      case 'review':
        return bounded(MODULES.GEN, 'ReviewResponder', <ReviewResponder />);
      case 'posts':
        return bounded(MODULES.GEN, 'PostCreator', <PostCreator />);
      case 'outreach':
        return bounded(MODULES.GEN, 'EmailOutreach', <EmailOutreach emails={emails} />);
      case 'settings':
        return bounded(MODULES.GEN, 'Settings', <Settings />);
      default:
        return bounded(MODULES.GEN, 'Dashboard', <Dashboard leads={leads} emails={emails} reports={reports} onNavigate={navigate} />);
    }
  };

  // Mark Find Leads as visited the first time we land on it, so it mounts and
  // then stays mounted (state preserved) on subsequent navigation.
  if (page === 'search') visitedSearchRef.current = true;

  return (
    <div className="flex h-screen w-full bg-base-200 overflow-hidden">
      {!isEmbed && <Sidebar currentPage={page} onNavigate={p => setPage(p)} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} onLogout={handleLogout} />}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isEmbed && <TopNavbar balance={balance} userEmail={getUserEmail()} onLogout={handleLogout} />}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4">
            <Suspense fallback={chunkFallback}>
              {/* Find Leads stays mounted (display:none when hidden) once visited
                  so its search state survives navigation. We don't mount it — and
                  thus don't download its heavy chunk — until the first visit. */}
              {visitedSearchRef.current && (
                <div style={{ display: page === 'search' ? 'block' : 'none' }}>
                  {/* onViewLead does NOT auto-save — only explicit Save/Bookmark button saves */}
                  <ErrorBoundary module={MODULES.LEAD} componentName="LeadSearch" user={getUserEmail()}>
                    <LeadSearch
                      onViewLead={(lead) => { handleViewDetail(lead.id); }}
                      onSaveLead={handleSaveLead}
                      onBulkSaveLeads={handleBulkSaveLeads}
                      savedLeadIds={leads.map(l => l.id)}
                      leads={leads}
                      onGenerateSites={handleGenerateSites}
                      siteGen={siteGen}
                      onCancelSiteGen={handleCancelSiteGen}
                      balance={balance}
                      onRefreshBalance={refreshBalance}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {page !== 'search' && renderPage()}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')).render(<App />);
