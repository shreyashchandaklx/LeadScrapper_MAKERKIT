/**
 * LeadScrapper PROD — Lead Search Component
 *
 * Searches Google Maps via Apify proxy for businesses, displaying results
 * with lead quality scoring and enabling saving/exporting.
 *
 * Features:
 * - Keyword, country, state, city, ZIP code search.
 * - Results sorting & column filtering.
 * - CSV export.
 * - Inline lead auditing (GBP claimed, website presence, reviews, etc.).
 * - Auto-save results to a parent component/database.
 * - Email extraction background workers.
 * - Credit deduction via Makerkit proxy (requires user email in localStorage).
 * - Unlimited Apify key rotation & caching.
 * - Pagination for results.
 * - Generates sites for leads (via onGenerateSites callback).
 */

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Search, MapPin, Filter, ChevronDown, ChevronUp, Star, Globe, Phone, Plus, Eye, AlertTriangle, Loader2,
  Download, Save, CheckCircle, Hash, Clock, Image, Tag, ExternalLink, ShieldCheck, ShieldX, MapPinned, Building,
  DollarSign, Bookmark, Mail, Flag, Zap
} from 'lucide-react';
import { getScoreColor, getScoreLabel } from '../utils/helpers.js';
import { extractEmailForUrl, getExtractEmailUrl } from '../utils/emailExtractor.js';
import { logError, extractErrorId, MODULES } from '../utils/errorLogger.js';
import { logActivity, EVENTS } from '../utils/activityLogger.js';
import { Country, State, City } from 'country-state-city';
import zipcodes from 'zipcodes';
import SearchableDropdown from './SearchableDropdown.jsx';

// In-memory cache for non-US ZIP fetches keyed by `${country}|${state}|${city}`.
// Lives across re-renders inside the module so re-picking the same city is instant.
const ZIP_API_CACHE = new Map();
const ZIP_INFLIGHT = new Map(); // de-duplicate concurrent fetches for the same city

// Use the local PHP proxy for all Apify tasks
// to securely keep API keys hidden on the backend.
// LOCAL TEST: on localhost we hit a local PHP server at :8000 so we can verify
// the cache layer before deploying. Revert this block before pushing to prod.
const APIFY_PROXY_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000/apify-proxy.php'
  : '/apify-proxy.php';

// City-scrape job orchestration proxy (Mode 2 — whole-city, no ZIP).
const CITY_SCRAPE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000/city-scrape-proxy.php'
  : '/city-scrape-proxy.php';

/* Scoring logic */
function computeLeadScore(p) {
  let score = 0;
  const issues = [];
  const gbp_claimed = p.claimThisBusiness !== false; // Treat undefined as claimed
  if (!gbp_claimed) { score += 25; issues.push('Google Business Profile is unclaimed'); }

  const has_website = !!p.website && p.website.length > 5;
  if (!has_website) { score += 20; issues.push('No website found'); }

  const has_ssl = has_website && (p.website || '').startsWith('https');
  if (has_website && !has_ssl) { score += 10; issues.push('Website missing SSL certificate'); }

  const mobile_responsive = has_website && has_ssl; // Simplistic check; could be improved
  if (has_website && !mobile_responsive) { score += 5; issues.push('Website may not be mobile responsive'); }

  const reviewCount = p.reviewsCount || 0;
  if (reviewCount === 0) { score += 20; issues.push('No Google reviews'); }
  else if (reviewCount < 10) { score += 15; issues.push('Very few Google reviews (under 10)'); }
  else if (reviewCount < 25) { score += 10; issues.push('Low Google review count (under 25)'); }
  else if (reviewCount < 50) { score += 5; issues.push('Below average review count'); }

  const rating = p.totalScore || 0;
  if (rating > 0 && rating < 3.5) { score += 10; issues.push('Low Google rating (below 3.5)'); }
  else if (rating >= 3.5 && rating < 4.0) { score += 5; issues.push('Average Google rating'); }

  const has_social = false; // Placeholder - social media detection not implemented
  if (!has_social) { score += 5; issues.push('No social media presence detected'); }

  const running_ads = p.isAdvertisement === true;

  let review_sentiment = 'none';
  if (reviewCount > 0) {
    if (rating >= 4.5) review_sentiment = 'positive';
    else if (rating >= 3.5) review_sentiment = 'mixed';
    else review_sentiment = 'negative';
  }
  return { score: Math.min(score, 100)/10, gbp_claimed, has_website, mobile_responsive, has_ssl, has_social, running_ads, review_sentiment, issues };
}

/* Convert Apify place to Lead */
function apifyToLead(p, idx) {
  const audit = computeLeadScore(p);
  return {
    id: p.placeId || `apify-${idx}-${Date.now()}`, // Use placeId if available, otherwise generate a temporary unique ID
    business_name: p.title || 'Unknown',
    address: p.address || '',
    city: p.city || '',
    state: p.state || '',
    phone: p.phone || '',
    email: '', // Will be populated later by email extraction
    website: p.website || '',
    category: p.categoryName || (p.categories || [])[0] || '',
    rating: p.totalScore || 0,
    review_count: p.reviewsCount || 0,
    score: audit.score,
    status: 'new', // Default status for new leads
    notes: '',
    source: 'Apify Google Maps',
    gbp_claimed: audit.gbp_claimed,
    has_website: audit.has_website,
    mobile_responsive: audit.mobile_responsive,
    has_ssl: audit.has_ssl,
    has_social: audit.has_social,
    running_ads: audit.running_ads,
    three_pack_rank: (p.rank && p.rank <= 3) ? p.rank : null,
    review_sentiment: audit.review_sentiment,
    issues: audit.issues,
    created_at: new Date().toISOString(),
    postal_code: p.postalCode || '',
    country: p.countryCode || '',
    neighborhood: p.neighborhood || '',
    price_level: p.price || '',
    description: p.description || '',
    opening_hours: (p.openingHours || []).map(h => `${h.day}: ${h.hours}`).join(', '),
    all_categories: p.categories || [],
    maps_url: p.url || '',
    place_id: p.placeId || '',
    images_count: p.imagesCount || 0,
    permanently_closed: p.permanentlyClosed || false,
    is_advertisement: p.isAdvertisement || false,
    // Raw Apify fields for direct use or Google Sheets storage
    _raw: {
      Title: p.title || '',
      Price: p.price || '',
      CategoryName: p.categoryName || '',
      Address: p.address || '',
      Neighborhood: p.neighborhood || '',
      Street: p.street || '',
      City: p.city || '',
      PostalCode: p.postalCode || '',
      State: p.state || '',
      CountryCode: p.countryCode || '',
      Phone: p.phone || '',
      PhoneUnformatted: p.phoneUnformatted || '',
      ClaimThisBusiness: p.claimThisBusiness === false ? 'Yes' : 'No', // Reversed logic for clarity
      Cid: p.cid || '',
      Location: p.location ? JSON.stringify(p.location) : '',
      TotalScore: p.totalScore || 0,
      ReviewsCount: p.reviewsCount || 0,
      ImagesCount: p.imagesCount || 0,
      ImageCategories: p.imageCategories ? JSON.stringify(p.imageCategories) : '',
      PeopleAlsoSearch: p.peopleAlsoSearch ? JSON.stringify(p.peopleAlsoSearch) : '',
      PlacesTags: p.placesTags ? JSON.stringify(p.placesTags) : '',
      ReviewsTags: p.reviewsTags ? JSON.stringify(p.reviewsTags) : '',
      GasPrices: p.gasPrices ? JSON.stringify(p.gasPrices) : '',
      GoogleFoodUrl: p.googleFoodUrl || '',
      HotelAds: p.hotelAds ? JSON.stringify(p.hotelAds) : '',
      OpeningHours: p.openingHours ? JSON.stringify(p.openingHours) : '',
      Url: p.url || '',
      SearchPageUrl: p.searchPageUrl || '',
      SearchString: p.searchString || '',
      Language: p.language || '',
      Rank: p.rank || idx + 1,
      IsAdvertisement: p.isAdvertisement ? 'Yes' : 'No',
      ImageUrl: p.imageUrl || '',
      Kgmid: p.kgmid || '',
      Website: p.website || '',
      AdditionalInfo: p.additionalInfo ? JSON.stringify(p.additionalInfo) : '',
      ReviewsDistribution: p.reviewsDistribution ? JSON.stringify(p.reviewsDistribution) : '',
      AdditionalOpeningHours: p.additionalOpeningHours ? JSON.stringify(p.additionalOpeningHours) : '',
      Description: p.description || '',
      LocatedIn: p.locatedIn || '',
      PlaceId: p.placeId || '',
    },
  };
}

/* Column configuration for the results table */
const ALL_COLUMNS = [
  { key: 'rank', label: '#', icon: Hash },
  { key: 'title', label: 'Business Name', icon: Building },
  { key: 'site', label: 'Site', icon: Globe },
  { key: 'score', label: 'Lead Score', icon: AlertTriangle },
  { key: 'categoryName', label: 'Category', icon: Tag },
  { key: 'address', label: 'Address', icon: MapPin },
  { key: 'neighborhood', label: 'Neighborhood', icon: MapPinned },
  { key: 'city', label: 'City', icon: MapPinned },
  { key: 'state', label: 'State', icon: MapPinned },
  { key: 'postalCode', label: 'Zip', icon: Hash },
  { key: 'countryCode', label: 'Country', icon: Globe },
  { key: 'phone', label: 'Phone', icon: Phone },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'website', label: 'Website', icon: Globe },
  { key: 'totalScore', label: 'Rating', icon: Star },
  { key: 'reviewsCount', label: 'Reviews', icon: Hash },
  { key: 'claimThisBusiness', label: 'GBP Status', icon: ShieldCheck },
  { key: 'price', label: 'Price', icon: DollarSign },
  { key: 'description', label: 'Description', icon: Tag },
  { key: 'openingHours', label: 'Hours', icon: Clock },
  { key: 'categories', label: 'All Categories', icon: Tag },
  { key: 'isAdvertisement', label: 'Running Ads', icon: DollarSign },
  { key: 'imagesCount', label: 'Photos', icon: Image },
  { key: 'permanentlyClosed', label: 'Perm Closed', icon: ShieldX },
  { key: 'temporarilyClosed', label: 'Temp Closed', icon: Clock },
  { key: 'url', label: 'Google Maps URL', icon: ExternalLink },
  { key: 'placeId', label: 'Place ID', icon: Hash },
  { key: 'issues', label: 'Issues Found', icon: AlertTriangle },
];

const DEFAULT_VISIBLE = ['rank', 'title', 'site', 'score', 'categoryName', 'address', 'phone', 'email', 'website', 'totalScore', 'reviewsCount', 'claimThisBusiness', 'price', 'isAdvertisement', 'issues'];

export default function LeadSearch({ onViewLead, onSaveLead, onBulkSaveLeads, savedLeadIds, leads = [], onGenerateSites, siteGen, onCancelSiteGen, balance: balanceProp, onRefreshBalance }) {
  const [keyword, setKeyword] = useState('');
  // country holds an ISO-2 country code (e.g. 'US'); defaults to USA per product spec.
  const [country, setCountry] = useState('US');
  // selectedState holds the state ISO code from country-state-city (e.g. 'CA' for California).
  const [selectedState, setSelectedState] = useState('');
  // selectedCity holds the city name (country-state-city has no stable city IDs).
  const [selectedCity, setSelectedCity] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false); // Track if the current search used the cache
  const [progress, setProgress] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [visibleCols, setVisibleCols] = useState(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;

  /* Refs for sentence-style Enter-to-next-field navigation */
  const keywordRef = useRef(null);
  const stateRef = useRef(null);
  const cityRef = useRef(null);
  const zipRef = useRef(null);

  /* Row selection state */
  const [selectedRows, setSelectedRows] = useState(new Set()); // Stores placeId/title of selected rows

  /* Email extraction state */
  const [emailMap, setEmailMap] = useState({}); // Stores emails found per placeId/title
  const [emailExtracting, setEmailExtracting] = useState(false);
  const [emailProgress, setEmailProgress] = useState({ completed: 0, total: 0, found: 0 });
  const emailCancelRef = useRef(false); // Ref to signal email extraction cancellation

  /* Credit system state */
  const userEmail = (typeof window !== 'undefined' && localStorage.getItem('loggedInUser')) || '';
  // Balance now lives in app.jsx (also shown in TopNavbar). Prop drives both surfaces.
  const balance = balanceProp;
  const refreshBalance = useCallback(() => {
    if (typeof onRefreshBalance === 'function') onRefreshBalance();
  }, [onRefreshBalance]);
  const [chargeInfo, setChargeInfo] = useState(null);    // Info about credits charged for the last search

  /* City-scrape (Mode 2) state */
  const [cityJob, setCityJob] = useState(null); // { jobId, zipsTotal, zipsDone, poolLeads, status }
  const cityPollRef = useRef(null);             // setInterval handle for job-status polling
  const cityCancelRef = useRef(false);          // user cancelled the city job (stop pulling)

  /* Inline error banner */
  const [bannerError, setBannerError] = useState(null);
  const bannerTimerRef = useRef(null);

  /* Timer refs */
  const timerRef = useRef(null);
  const cancelRef = useRef(false); // Ref to signal search cancellation
  const cacheModeRef = useRef(false); // Tracks if current search is using cached data

  // Clear any live intervals on unmount (city poll, elapsed timer).
  useEffect(() => () => {
    if (cityPollRef.current) clearInterval(cityPollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    cityCancelRef.current = true;
  }, []);

  // Auto-dismiss banner error after 6 seconds
  useEffect(() => {
    if (bannerError) {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBannerError(null), 6000);
    }
    return () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); };
  }, [bannerError]);

  // Memoized country-state-city lookups.
  const allCountries = useMemo(() => Country.getAllCountries(), []);

  const statesList = useMemo(
    () => (country ? State.getStatesOfCountry(country) : []),
    [country]
  );

  const citiesList = useMemo(
    () => (country && selectedState ? City.getCitiesOfState(country, selectedState) : []),
    [country, selectedState]
  );

  // ZIP cascade:
  //   • US  → bundled `zipcodes` package — offline, instant.
  //   • IN  → api.postalpincode.in (India Post, free, no key, CORS-enabled). Filtered by state name.
  //   • else → Zippopotam (free, no key, CORS-enabled).
  // All API responses are cached in module-level Maps so re-picking the same city is instant.
  // Unsupported countries fall back gracefully to a free-text ZIP input.
  const [zipOptions, setZipOptions] = useState([]); // string[]
  const [zipLoading, setZipLoading] = useState(false);
  const [zipApiSupported, setZipApiSupported] = useState(true); // false → render text input fallback

  useEffect(() => {
    // No city picked yet → nothing to do.
    if (!country || !selectedState || !selectedCity) {
      setZipOptions([]);
      setZipLoading(false);
      setZipApiSupported(true);
      return;
    }

    // Fast path: US uses bundled `zipcodes` package — fully offline, instant.
    if (country === 'US') {
      try {
        const rows = zipcodes.lookupByName(selectedCity, selectedState) || [];
        const codes = Array.from(new Set(rows.map(r => String(r.zip)))).sort();
        setZipOptions(codes);
        setZipApiSupported(codes.length > 0);
      } catch {
        setZipOptions([]);
        setZipApiSupported(false);
      }
      setZipLoading(false);
      return;
    }

    // Non-US path: fetch from a country-appropriate free API, with module-level cache.
    const key = `${country}|${selectedState}|${selectedCity}`;
    if (ZIP_API_CACHE.has(key)) {
      const cached = ZIP_API_CACHE.get(key);
      setZipOptions(cached.codes);
      setZipApiSupported(cached.supported);
      setZipLoading(false);
      return;
    }

    let cancelled = false;
    setZipLoading(true);

    // Resolve a friendly state name for India's API (which expects the full state name
    // like "Maharashtra", not the ISO code "MH"). Falls back to ISO if not found.
    const resolvedStateName =
      (country ? State.getStatesOfCountry(country) : [])
        .find(s => s.isoCode === selectedState)?.name || selectedState;

    const fetchZips = async () => {
      // Deduplicate parallel fetches for the same key (e.g. StrictMode double-effect).
      if (!ZIP_INFLIGHT.has(key)) {
        const promise = (async () => {
          try {
            if (country === 'IN') {
              // India Post: returns up to 31+ post offices per city query, with State field
              // so we can filter to just the user's selected state.
              const res = await fetch(`https://api.postalpincode.in/postoffice/${encodeURIComponent(selectedCity)}`);
              if (!res.ok) return { codes: [], supported: false };
              const data = await res.json();
              const entry = Array.isArray(data) ? data[0] : null;
              const offices = entry?.PostOffice || [];
              const targetState = resolvedStateName.toLowerCase();
              const filtered = offices.filter(o => (o.State || '').toLowerCase() === targetState);
              // If no rows matched the state (e.g. ambiguous city name in different states),
              // fall back to all rows so the user still sees something.
              const rows = filtered.length > 0 ? filtered : offices;
              const codes = Array.from(new Set(rows.map(o => String(o.Pincode)))).sort();
              return { codes, supported: codes.length > 0 };
            }
            // Default: Zippopotam — works for US (already handled above), UK, DE, CA, ~70 more.
            const cc = country.toLowerCase();
            const region = encodeURIComponent(selectedState.toLowerCase());
            const place = encodeURIComponent(selectedCity.toLowerCase());
            const res = await fetch(`https://api.zippopotam.us/${cc}/${region}/${place}`);
            if (!res.ok) return { codes: [], supported: false };
            const data = await res.json();
            const codes = Array.from(new Set((data.places || []).map(p => String(p['post code'])))).sort();
            return { codes, supported: codes.length > 0 };
          } catch {
            return { codes: [], supported: false };
          }
        })();
        ZIP_INFLIGHT.set(key, promise);
      }
      const result = await ZIP_INFLIGHT.get(key);
      ZIP_INFLIGHT.delete(key);
      ZIP_API_CACHE.set(key, result);
      if (cancelled) return;
      setZipOptions(result.codes);
      setZipApiSupported(result.supported);
      setZipLoading(false);
    };
    fetchZips();

    return () => { cancelled = true; };
  }, [country, selectedState, selectedCity]);

  // Resolve display names from ISO codes for the location chip + Apify payload.
  const countryName = useMemo(
    () => allCountries.find(c => c.isoCode === country)?.name || country,
    [country, allCountries]
  );
  const stateName = useMemo(
    () => statesList.find(s => s.isoCode === selectedState)?.name || selectedState,
    [statesList, selectedState]
  );

  // Derive location string from cascading selections for display/search
  const location = useMemo(() => {
    const parts = [];
    if (selectedCity) parts.push(selectedCity);
    if (stateName) parts.push(stateName);
    if (countryName) parts.push(countryName);
    return parts.join(', ');
  }, [countryName, stateName, selectedCity]);

  /* Start email extraction process */
  const startEmailExtraction = useCallback(async (places) => {
    const endpoint = getExtractEmailUrl();
    if (!endpoint) return; // Skip if email extraction service isn't available (e.g., localhost)

    const withWebsite = places.filter(p => p.website && p.website.length > 5);
    if (withWebsite.length === 0) return;

    setEmailExtracting(true);
    emailCancelRef.current = false; // Reset cancel flag
    setEmailProgress({ completed: 0, total: withWebsite.length, found: 0 });

    let completed = 0;
    let found = 0;
    const queue = [...withWebsite]; // Copy places to a queue

    const worker = async () => {
      while (queue.length > 0 && !emailCancelRef.current) {
        const place = queue.shift(); // Get next place from queue
        if (!place) break;
        try {
          const result = await extractEmailForUrl(place.website);
          const id = place.placeId || place.title; // Use placeId or title for mapping
          if (result.emails.length > 0) {
            found += result.emails.length;
            setEmailMap(prev => ({ ...prev, [id]: result.emails })); // Update email map
          } else {
            setEmailMap(prev => ({ ...prev, [id]: [] })); // Ensure entry exists even if no emails found
          }
        } catch (error) {
          // Log individual extraction errors but continue
          console.error("Email extraction failed for website:", place.website, error);
          setEmailMap(prev => ({ ...prev, [place.placeId || place.title]: [] })); // Mark as processed, no emails
        } finally {
          completed++;
          setEmailProgress({ completed, total: withWebsite.length, found });
        }
      }
    };

    // Run 3 workers concurrently to speed up extraction
    await Promise.all([worker(), worker(), worker()]);
    setEmailExtracting(false); // Done extracting
  }, []);

  /* Pull one ZIP's leads through the existing per-ZIP proxy flow and merge them
   * into the results table. Reuses apify-proxy.php run→check→dataset verbatim, so:
   *   - a ZIP the worker already scraped is a cache hit (free, no Apify),
   *   - applyCreditSlice() bills this user for leads new to them (billing-on-view),
   *   - per-user dedup (global by PlaceId) prevents double-charging border dupes.
   * Returns the number of NEW leads merged. Safe to call repeatedly.
   */
  const pullZipLeads = useCallback(async (zip) => {
    const body = {
      email: userEmail,
      searchStringsArray: [keyword.trim()],
      language: 'en',
      maxReviews: 0,
      maxImages: 0,
      postalCode: zip,
      countryCode: country.toLowerCase(),
      maxCrawledPlacesPerSearch: 9999,
    };
    const runResp = await fetch(`${APIFY_PROXY_URL}?action=run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (runResp.status === 402) {
      const e = await runResp.json().catch(() => ({}));
      refreshBalance();
      throw Object.assign(new Error('insufficient-credits'), { code: 402, balance: e.balance });
    }
    if (!runResp.ok) return 0; // skip this ZIP on transient error; others continue
    const runData = await runResp.json();
    const runId = runData?.data?.id;
    const datasetId = runData?.data?.defaultDatasetId;
    if (!runId || !datasetId) return 0;

    // Poll until terminal (cache hits return SUCCEEDED immediately).
    let status = runData?.data?.status || 'RUNNING';
    let attempts = 0;
    while ((status === 'RUNNING' || status === 'READY') && attempts < 180 && !cityCancelRef.current) {
      await new Promise(r => setTimeout(r, 5000));
      attempts++;
      const pr = await fetch(`${APIFY_PROXY_URL}?action=check&runId=${runId}`);
      if (!pr.ok) continue;
      status = (await pr.json())?.data?.status || 'UNKNOWN';
    }
    if (status !== 'SUCCEEDED') return 0;

    const dr = await fetch(`${APIFY_PROXY_URL}?action=dataset&datasetId=${datasetId}&runId=${runId}&limit=9999`);
    if (!dr.ok) return 0;
    const env = await dr.json();
    const places = Array.isArray(env.places) ? env.places : (Array.isArray(env) ? env : []);
    if (!places.length) return 0;

    // Merge into results (dedupe by placeId), and auto-save like single-ZIP mode.
    let added = 0;
    setResults(prev => {
      const seen = new Set(prev.map(p => p.placeId || p.title));
      const fresh = places.filter(p => !seen.has(p.placeId || p.title));
      added = fresh.length;
      fresh.forEach((p, i) => { if (!p.rank) p.rank = prev.length + i + 1; });
      return prev.concat(fresh);
    });
    if (typeof onBulkSaveLeads === 'function') {
      const savedSet = new Set(savedLeadIds || []);
      const toSave = places.map((p, i) => apifyToLead(p, i)).filter(l => !savedSet.has(l.id));
      if (toSave.length) onBulkSaveLeads(toSave);
    }
    if (typeof env.charged === 'number') {
      setChargeInfo(ci => ({
        delivered:       (ci?.delivered || 0) + (env.delivered ?? places.length),
        totalDelivered:  (ci?.totalDelivered || 0) + (env.delivered ?? places.length),
        charged:         (ci?.charged || 0) + Number(env.charged ?? 0),
        extrasRemaining: env.extrasRemaining ?? 0,
        poolSize:        (ci?.poolSize || 0) + (env.poolSize ?? places.length),
        source:          'city',
        cached:          true,
      }));
    }
    return added;
  }, [userEmail, keyword, country, onBulkSaveLeads, savedLeadIds, refreshBalance]);

  /* Mode 2: whole-city scrape. Creates a shared city job (backend worker scrapes
   * the ZIPs), then polls progress and pulls each ZIP's leads as they complete. */
  const handleCityScrape = useCallback(async () => {
    if (!zipApiSupported || zipOptions.length === 0) {
      alert('Whole-city scraping is not available for this location — please enter a ZIP/PIN code.');
      return;
    }
    // BYOK gate: user MUST have a saved Apify key before any search
    try {
      const keyCheck = await fetch(`${APIFY_PROXY_URL.replace('apify-proxy.php', 'apify-key.php')}?action=get&email=${encodeURIComponent(userEmail)}`);
      const keyData = await keyCheck.json();
      if (!keyData.hasKey) {
        setBannerError('Add your Apify API key using the key icon in the top bar before searching.');
        return;
      }
    } catch (e) {
      setBannerError('Could not verify your Apify API key. Please check your connection and try again.');
      return;
    }
    setLoading(true);
    setResults([]);
    setChargeInfo(null);
    setSelectedRows(new Set());
    setEmailMap({});
    cityCancelRef.current = false;
    cancelRef.current = false;
    const start = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try {
      setProgress(`Starting whole-city scrape for "${keyword}" in ${selectedCity}, ${selectedState} (${zipOptions.length} ZIPs)...`);
      const createResp = await fetch(`${CITY_SCRAPE_URL}?action=create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          keyword: keyword.trim(),
          country: country.toLowerCase(),
          state: selectedState,
          city: selectedCity,
          zips: zipOptions,
        }),
      });
      if (!createResp.ok) {
        const e = await createResp.json().catch(() => ({}));
        throw Object.assign(new Error(e.error || `Failed to start city scrape (${createResp.status})`), { errorId: extractErrorId(e) });
      }
      const { jobId, zipsTotal, targetLeads } = await createResp.json();
      const target = targetLeads || 100;
      setCityJob({ jobId, zipsTotal, zipsDone: 0, poolLeads: 0, targetLeads: target, status: 'running' });

      // Pull leads ONLY for ZIPs the backend reports as 'scraped'. pullZipLeads
      // hits the per-ZIP cache (free Apify, billed-on-view); restricting to
      // already-scraped ZIPs ensures the browser never races the worker with a
      // live run. A pull is serialized (one ZIP at a time) so credit slices apply
      // in order and a 402 stops cleanly.
      const pulledZips = new Set();
      let pulling = false; // guard against overlapping poll ticks
      const pullScraped = async (scrapedZips) => {
        if (pulling) return;
        pulling = true;
        try {
          for (const zip of (scrapedZips || [])) {
            if (cityCancelRef.current) break;
            if (pulledZips.has(zip)) continue;
            pulledZips.add(zip);
            try {
              await pullZipLeads(zip);
            } catch (err) {
              if (err.code === 402) { cityCancelRef.current = true; throw err; }
              pulledZips.delete(zip); // transient error — allow a later retry
            }
          }
        } finally {
          pulling = false;
        }
      };

      // Poll job status for progress display; pull each newly-scraped ZIP; stop
      // when the job completes (or every ZIP is done/failed).
      let pollError = null;
      await new Promise((resolve) => {
        cityPollRef.current = setInterval(async () => {
          if (cityCancelRef.current) { clearInterval(cityPollRef.current); resolve(); return; }
          try {
            const sr = await fetch(`${CITY_SCRAPE_URL}?action=status&jobId=${jobId}`);
            if (sr.ok) {
              const st = await sr.json();
              setCityJob(cj => ({ ...cj, ...{
                zipsDone: st.zipsDone, zipsTotal: st.zipsTotal,
                poolLeads: st.poolLeads, targetLeads: st.targetLeads || target, status: st.status,
              }}));
              const tgt = st.targetLeads || target;
              setProgress(`Scraping ${selectedCity}: ${Math.min(st.poolLeads, tgt)}/${tgt} leads · ${st.zipsDone}/${st.zipsTotal} ZIPs`);
              await pullScraped(st.scrapedZips);
              // Stop when the target is reached (worker stops claiming new ZIPs at
              // that point), OR when the queue is exhausted (whole city scraped but
              // still short of target — nothing more to scrape).
              // Guard: never terminate when zipsTotal is 0 — that means the DB
              // counter hasn't been populated yet (stale row or failed update).
              if (st.poolLeads >= tgt
                  || st.status === 'completed'
                  || (st.zipsTotal > 0 && (st.zipsDone + st.zipsFailed) >= st.zipsTotal)) {
                clearInterval(cityPollRef.current);
                resolve();
              }
            }
          } catch (err) {
            if (err.code === 402) { pollError = err; clearInterval(cityPollRef.current); resolve(); return; }
            // transient network/poll error — keep polling
          }
        }, 6000);
      });

      if (pollError) throw pollError;

      // Final sweep: a guarded/concurrent tick may have skipped the last batch.
      // Re-fetch the scraped list once and pull anything still outstanding.
      if (!cityCancelRef.current) {
        try {
          const fr = await fetch(`${CITY_SCRAPE_URL}?action=status&jobId=${jobId}`);
          if (fr.ok) {
            const fst = await fr.json();
            await pullScraped(fst.scrapedZips);
          }
        } catch (err) {
          if (err.code === 402) throw err;
        }
      }
      setProgress(`Whole-city scrape complete for ${selectedCity}.`);
      logActivity(EVENTS.CITY_SEARCH, { user: userEmail, count: cityJob?.poolLeads || 0, meta: { keyword, city: selectedCity, state: selectedState } });
      refreshBalance();
    } catch (error) {
      const isUserError = /insufficient[- ]credits/i.test(error.message || '');
      let errorId = error.errorId || null;
      if (!errorId && !isUserError) {
        errorId = logError(MODULES.LEAD, error, { user: userEmail || 'anonymous', component: 'LeadSearch', action: 'city-scrape' });
      }
      // BYOK-friendly error messages
      const isNoKey = /NO_APIFY_KEY/i.test(error.message || '') || /add your apify api key/i.test(error.message || '');
      const isInvalidKey = /INVALID_APIFY_KEY/i.test(error.message || '') || /invalid.*apify.*key/i.test(error.message || '');
      let msg = isUserError ? 'You ran out of credits — top up at app.pixnom.com to get the rest.' : error.message;
      if (isNoKey) msg = 'Add your Apify API key using the key icon in the top bar before starting a city scrape.';
      else if (isInvalidKey) msg = 'Your Apify API key is invalid, expired, or lacks access to the Google Maps scraper. Update it using the key icon in the top bar.';

      setProgress(`Error: ${msg}${errorId ? ` (Error ID: ${errorId})` : ''}`);
      alert(`City scrape: ${msg}${errorId ? `\n\nError ID: ${errorId}` : ''}`);
    } finally {
      if (cityPollRef.current) clearInterval(cityPollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      setLoading(false);
    }
  }, [userEmail, keyword, country, selectedState, selectedCity, zipOptions, zipApiSupported, pullZipLeads, refreshBalance]);

  /* Cancel the active search. For a single-ZIP search this just flips cancelRef.
   * For a city scrape it stops the frontend poller/puller and unsubscribes the
   * user from the shared job (the backend worker keeps running for others). */
  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    cityCancelRef.current = true;
    if (cityPollRef.current) clearInterval(cityPollRef.current);
    if (cityJob?.jobId) {
      fetch(`${CITY_SCRAPE_URL}?action=cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: cityJob.jobId, email: userEmail }),
      }).catch(() => {}); // best-effort unsubscribe
    }
  }, [cityJob, userEmail]);

  /* Handle the main search operation.
   *
   * TWO MODES (sir's refinement — ZIP optional):
   *   • ZIP entered  → Mode 1: scrape that single ZIP (today's exact flow).
   *   • No ZIP       → Mode 2: scrape the WHOLE city in the background via a
   *                    city-scrape job; leads stream in per completed ZIP.
   */
  const handleSearch = async () => {
    if (!keyword.trim() || !country || !selectedState) {
      alert('Please fill in: Keyword, Country, and State.');
      return;
    }
    if (!userEmail) {
      alert('You must be logged in. Please log in with your email to search for leads.');
      return;
    }

    // BYOK gate: user MUST have a saved Apify key before any search (cache hit or miss)
    try {
      const keyCheck = await fetch(`${APIFY_PROXY_URL.replace('apify-proxy.php', 'apify-key.php')}?action=get&email=${encodeURIComponent(userEmail)}`);
      const keyData = await keyCheck.json();
      if (!keyData.hasKey) {
        setBannerError('Add your Apify API key using the key icon in the top bar before searching.');
        return;
      }
    } catch (e) {
      setBannerError('Could not verify your Apify API key. Please check your connection and try again.');
      return;
    }

    // PostHog: track search
    if (window.posthog) {
      posthog.capture('lead_search', { keyword, country, state: selectedState, city: selectedCity, zip: zipCode });
    }

    // No ZIP → whole-city mode.
    if (!zipCode.trim()) {
      return handleCityScrape();
    }

    // Reset state for new search
    setLoading(true);
    setResults([]);
    setChargeInfo(null);
    setCityJob(null); // clear any stale whole-city progress
    setProgress('Preparing search parameters...');
    setServedFromCache(false);
    cacheModeRef.current = false;
    setSelectedRows(new Set());
    setEmailMap({});
    setEmailExtracting(false);
    setEmailProgress({ completed: 0, total: 0, found: 0 });
    cancelRef.current = false; // Reset cancellation flag
    emailCancelRef.current = true; // Cancel any ongoing email extraction
    setElapsed(0);
    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000); // Start timer

    try {
      setProgress('Starting Google Maps scraper...');

      // Build request body for the Apify proxy
      const requestBody = {
        email: userEmail, // Required for credit deduction
        searchStringsArray: [keyword.trim()],
        language: "en",
        maxReviews: 0,
        maxImages: 0
      };

      // Use discrete geo fields (postalCode, countryCode) for precise area search
      if (zipCode.trim()) {
        requestBody.postalCode = zipCode.trim();
        if (country) {
          // country is already an ISO-2 code (e.g. 'US') from country-state-city.
          requestBody.countryCode = country.toLowerCase();
        }
        // Set a high limit to fetch all available results for the specified ZIP code
        requestBody.maxCrawledPlacesPerSearch = 9999;
      } else {
        // Fallback to location-based search if ZIP is not provided
        requestBody.locationQuery = location.trim();
        requestBody.maxCrawledPlacesPerSearch = 500; // Default limit for locationQuery
      }

      // Initiate the search via the proxy
      const runResponse = await fetch(`${APIFY_PROXY_URL}?action=run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (runResponse.status === 402) { // Insufficient credits
        const errorData = await runResponse.json().catch(() => ({}));
        refreshBalance(); // Re-pull balance from app.jsx (balance is a prop, not local state)
        throw new Error(`Insufficient credits (balance ${errorData.balance ?? 0}). Top up at app.pixnom.com to continue.`);
      }
      if (runResponse.status === 503) { // Apify keys exhausted
        const errorData = await runResponse.json().catch(() => ({}));
        const err503 = new Error("Server capacity reached (Apify keys exhausted). Please contact support or try again later.");
        err503.errorId = extractErrorId(errorData); // backend already logged it
        throw err503;
      }
      if (!runResponse.ok) { // Other API errors
        const errorData = await runResponse.json().catch(() => ({}));
        const msg = errorData?.error?.message || errorData?.error || errorData?.message || `Failed to start Apify run (${runResponse.status})`;
        const errOther = new Error(
          msg.includes('Apify API keys exhausted')
            ? "Server capacity reached (Apify keys exhausted). Please contact support or try again later."
            : msg
        );
        errOther.errorId = extractErrorId(errorData); // backend already logged it
        errOther.httpStatus = runResponse.status;
        throw errOther;
      }

      const runData = await runResponse.json();
      const runId = runData?.data?.id;
      const datasetId = runData?.data?.defaultDatasetId;
      const cached = runData?._cached === true;
      cacheModeRef.current = cached; // Set cache mode flag
      setServedFromCache(cached);

      if (!runId || !datasetId) throw new Error('Failed to capture run and dataset metadata');

      const searchLabel = zipCode.trim() ? `ZIP ${zipCode.trim()}` : `"${location}"`;
      setProgress(cached
        ? `Fetching cached results for "${keyword}" in ${searchLabel}...`
        : `Scraping Google Maps for "${keyword}" in ${searchLabel}...`);

      let status = 'RUNNING';
      let attempts = 0;
      const MAX_POLL_ATTEMPTS = 180; // Max polls (180 * 5s = 15 minutes)

      // Poll for run status until completion or cancellation
      while ((status === 'RUNNING' || status === 'READY') && attempts < MAX_POLL_ATTEMPTS && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds between polls
        attempts++;
        setProgress(`Scraping in progress... (poll ${attempts}/${MAX_POLL_ATTEMPTS})`);

        const pollResponse = await fetch(`${APIFY_PROXY_URL}?action=check&runId=${runId}`);
        if (!pollResponse.ok) continue; // Ignore poll errors, retry next poll

        const pollData = await pollResponse.json();
        status = pollData?.data?.status || 'UNKNOWN';
        // Update progress with status message if available
        if (pollData?.data?.statusMessage) {
          setProgress(`${status}: ${pollData.data.statusMessage.substring(0, 100)}`);
        }
      }

      if (cancelRef.current) {
        setProgress('Search cancelled by user.');
        return; // Stop if cancelled
      }

      if (status !== 'SUCCEEDED') { // Handle non-success completion
        throw new Error(`Scraper run ended with status: ${status}. Check Apify dashboard for details.`);
      }

      setProgress('Fetching results from dataset...');
      // Fetch results from the dataset
      const dataResponse = await fetch(`${APIFY_PROXY_URL}?action=dataset&datasetId=${datasetId}&runId=${runId}&limit=9999`);
      if (!dataResponse.ok) throw new Error(`Failed to fetch results (${dataResponse.status})`);

      let apifyResults = await dataResponse.json();
      if (apifyResults.error || apifyResults.success === false) { // Handle API errors from dataset fetch
        throw new Error(apifyResults.error?.message || apifyResults.message || apifyResults.error || 'Dataset fetch failed');
      }

      const rawData = apifyResults;
      const envelope = (rawData && typeof rawData === 'object' && !Array.isArray(rawData))
        ? rawData
        : { places: Array.isArray(rawData) ? rawData : [], charged: 0, delivered: 0, extrasRemaining: 0, source: 'unknown' };
      const places = Array.isArray(envelope.places) ? envelope.places : (envelope.items || envelope.data || []);
      places.forEach((p, i) => { if (!p.rank) p.rank = i + 1; });

      setChargeInfo({
        delivered:       envelope.delivered ?? places.length,
        totalDelivered:  envelope.totalDelivered ?? (envelope.delivered ?? places.length),
        charged:         Number(envelope.charged ?? 0),
        extrasRemaining: envelope.extrasRemaining ?? 0,
        poolSize:        envelope.poolSize ?? places.length,
        source:          envelope.source ?? (cached ? 'cache' : 'apify'),
        cached,
      });
      setResults(places);
      setCurrentPage(1);
      refreshBalance();

      const totalFound = envelope.poolSize ?? places.length;
      setProgress(`Found ${totalFound} total businesses (showing ${places.length}) — Charged ${(envelope.charged ?? 0).toFixed(2)} credits.`);

      // Start background email extraction for found places
      startEmailExtraction(places);

      // Auto-save all fetched leads to the parent component (e.g., for CRM storage)
      const allFetchedLeads = places.map((p, i) => apifyToLead(p, i));
      const savedSet = new Set(savedLeadIds || []);
      const leadsToSave = allFetchedLeads.filter(lead => !savedSet.has(lead.id)); // Only save new leads

      console.log('[LeadSearch] Auto-saving leads:', {
        leadsFound: places.length,
        alreadySavedCount: savedLeadIds?.length || 0,
        toSaveCount: leadsToSave.length,
        onBulkSaveLeadsExists: typeof onBulkSaveLeads === 'function',
      });

      if (typeof onBulkSaveLeads !== 'function') {
        console.error('[LeadSearch] `onBulkSaveLeads` prop is missing. Cannot auto-save leads.');
      } else if (leadsToSave.length > 0) {
        onBulkSaveLeads(leadsToSave);
      } else {
        console.warn('[LeadSearch] No new leads to save; all results already exist in `savedLeadIds`.');
      }

      // Mode-1 reuse hook: this single ZIP is now scraped under its city+keyword.
      // Record it so a later whole-city run for the same city skips it (status
      // 'scraped') instead of re-scraping. Fire-and-forget — never block results.
      if (selectedCity && selectedState && zipCode.trim()) {
        fetch(`${CITY_SCRAPE_URL}?action=record-zip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: userEmail,
            keyword: keyword.trim(),
            country: country.toLowerCase(),
            state: selectedState,
            city: selectedCity,
            zip: zipCode.trim(),
            leadsCount: places.length,
          }),
        }).catch(() => {}); // best-effort; a failure just means this ZIP gets re-scraped later
      }

    } catch (error) {
      console.error('Search operation failed:', error);
      // Use the backend's errorId when the proxy already logged it; otherwise
      // log from here. Insufficient-credits (402) is a user condition, not a bug
      // — show it without an Error ID and don't log it.
      const isUserError = /insufficient credits/i.test(error.message || '');
      let errorId = error.errorId || null;
      if (!errorId && !isUserError) {
        errorId = logError(MODULES.LEAD, error, {
          user: userEmail || 'anonymous',
          component: 'LeadSearch',
          action: 'search',
        });
      }
      // BYOK-friendly error messages
      const isNoKey = /NO_APIFY_KEY/i.test(error.message || '') || /add your apify api key/i.test(error.message || '');
      const isInvalidKey = /INVALID_APIFY_KEY/i.test(error.message || '') || /invalid.*apify.*key/i.test(error.message || '');
      let userMsg = error.message;
      if (isNoKey) userMsg = 'Add your Apify API key using the key icon in the top bar before searching new leads.';
      else if (isInvalidKey) userMsg = 'Your Apify API key is invalid, expired, or lacks access to the Google Maps scraper. Update it using the key icon in the top bar.';

      const suffix = errorId ? `\n\nError ID: ${errorId}` : '';
      setProgress(`Error: ${userMsg}${errorId ? ` (Error ID: ${errorId})` : ''}`);
      alert(`Search failed: ${userMsg}${suffix}`);
    } finally {
      // Cleanup timer and loading state
      if (timerRef.current) clearInterval(timerRef.current);
      setLoading(false);
    }
  };

  // Memoized sorted results based on current sort key and direction
  const sortedResults = useMemo(() => {
    const arr = [...results]; // Create a mutable copy
    arr.sort((a, b) => {
      let valA, valB;
      // Use computeLeadScore for 'score' sorting, otherwise direct property access
      if (sortKey === 'score') {
        valA = computeLeadScore(a).score;
        valB = computeLeadScore(b).score;
      } else { // Direct property access for other keys
        valA = a[sortKey];
        valB = b[sortKey];
      }
      // Handle null/undefined values gracefully
      if (valA == null) valA = '';
      if (valB == null) valB = '';

      // Numeric vs. string comparison
      if (typeof valA === 'number' && typeof valB === 'number') return sortDir === 'asc' ? valA - valB : valB - valA;
      return sortDir === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });
    return arr;
  }, [results, sortKey, sortDir]);

  // Handler for changing sort key and direction
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(direction => direction === 'asc' ? 'desc' : 'asc'); // Toggle direction if same key
    else { setSortKey(key); setSortDir('asc'); } // Reset direction if new key
  };

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedResults = useMemo(
    () => sortedResults.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedResults, safePage]
  );

  /* Function to trigger CSV download */
  const downloadCSV = (places) => {
    // Define CSV headers for all possible columns
    const headers = [
      'Rank', 'Business Name', 'Lead Score', 'Email', 'Description', 'Price', 'Category', 'All Categories',
      'Address', 'Neighborhood', 'Street', 'City', 'State', 'Zip', 'Country',
      'Phone', 'Phone Unformatted', 'Website', 'Has SSL', 'Rating', 'Reviews', 'Images Count',
      'GBP Claimed', 'Permanently Closed', 'Temporarily Closed',
      'Running Ads', 'Opening Hours', 'Place ID', 'Google Maps URL',
      'Latitude', 'Longitude', 'Issues Found', 'Scraped At'
    ];

    // Helper to escape values for CSV format
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const s = String(val);
      // Enclose in quotes and double any existing quotes
      return `"${s.replace(/"/g, '""')}"`;
    };

    // Map places data to CSV rows
    const rows = places.map((p, i) => {
      const audit = computeLeadScore(p);
      // Get emails for this place (may be empty if extraction failed or not run)
      const placeEmails = emailMap[p.placeId || p.title] || [];
      const placePhone = p.phone || '';
      const locationLat = p.location?.lat || '';
      const locationLng = p.location?.lng || '';

      // Map data fields to corresponding CSV headers
      const fields = [
        p.rank || i + 1, // Rank or index
        p.title || '',
        audit.score,
        placeEmails.join('; '), // Join multiple emails with semicolon
        p.description || '',
        p.price || '',
        p.categoryName || '',
        (p.categories || []).join(', '),
        p.address || '',
        p.neighborhood || '',
        p.street || '',
        p.city || '',
        p.state || '',
        p.postalCode || '',
        p.countryCode || '',
        placePhone,
        p.phoneUnformatted || '',
        p.website || '',
        (p.website || '').startsWith('https') ? 'Yes' : 'No', // SSL check
        p.totalScore || '',
        p.reviewsCount || 0,
        p.imagesCount || 0,
        p.claimThisBusiness === false ? 'Yes' : 'No', // GBP Claimed status
        p.permanentlyClosed ? 'Yes' : 'No',
        p.temporarilyClosed ? 'Yes' : 'No',
        p.isAdvertisement ? 'Yes' : 'No',
        (p.openingHours || []).map(h => `${h.day}: ${h.hours}`).join('; '), // Format opening hours
        p.placeId || '',
        p.url || '',
        locationLat,
        locationLng,
        audit.issues.join('; '), // Join issues with semicolon
        p.scrapedAt || '' // Timestamp of when Apify scraped the data
      ];
      return fields.map(escapeCsv).join(','); // Join fields with comma, escape each
    });

    // Combine headers and rows, create Blob, and initiate download
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    // Generate filename based on keyword, location, and date
    anchor.download = `leads_${keyword.replace(/\s+/g, '_')}_${location.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click(); // Trigger download
    URL.revokeObjectURL(url); // Clean up object URL
    logActivity(EVENTS.EXPORT, { user: userEmail, count: places.length, meta: { source: 'search', keyword } });
    // PostHog: track export
    if (window.posthog) {
      posthog.capture('lead_export', { source: 'search', keyword, count: places.length });
    }
  };

  /* Toggle selection for all rows */
  const toggleSelectAll = () => {
    if (selectedRows.size === sortedResults.length && sortedResults.length > 0) {
      setSelectedRows(new Set()); // Deselect all if all are currently selected
    } else {
      // Select all rows
      setSelectedRows(new Set(sortedResults.map(place => place.placeId || place.title)));
    }
  };

  /* Save selected leads via bulk API call */
  const saveSelectedLeads = () => {
    const leadsToSave = [];
    sortedResults.forEach((place, index) => {
      if (selectedRows.has(place.placeId || place.title)) {
        const lead = apifyToLead(place, index);
        const emails = emailMap[place.placeId || place.title] || [];
        if (emails.length > 0) lead.email = emails[0];
        if (!savedLeadIds.includes(lead.id)) leadsToSave.push(lead);
      }
    });
    if (leadsToSave.length > 0 && typeof onBulkSaveLeads === 'function') {
      onBulkSaveLeads(leadsToSave); // Call parent handler
    } else if (leadsToSave.length === 0) {
      console.warn('[LeadSearch] No new leads selected for saving.');
    }
  };

  /* Save ALL leads from the current search results via bulk API call */
  const saveAllLeads = () => {
    const leadsToSave = [];
    sortedResults.forEach((place, index) => { // Iterate through all fetched places
      const lead = apifyToLead(place, index);
      const emails = emailMap[place.placeId || place.title] || [];
      if (emails.length > 0) lead.email = emails[0];
      if (!savedLeadIds.includes(lead.id)) leadsToSave.push(lead); // Add only if not already saved
    });
    if (leadsToSave.length > 0 && typeof onBulkSaveLeads === 'function') {
      onBulkSaveLeads(leadsToSave); // Call parent handler
    } else if (leadsToSave.length === 0) {
      console.warn('[LeadSearch] No new leads to save; all results already exist in `savedLeadIds`.');
    }
  };

  /* Memoized map of saved leads by ID for quick lookup */
  const leadByIdMap = useMemo(() => {
    const map = new Map();
    (leads || []).forEach(lead => { if (lead.id) map.set(lead.id, lead); });
    return map;
  }, [leads]); // Update map when the `leads` prop changes

  /* Render cell content based on column key */
  const renderCell = (placeData, columnKey, index) => {
    const audit = computeLeadScore(placeData); // Recalculate audit score for rendering
    const emails = emailMap[placeData.placeId || placeData.title] || [];
    const isSaved = savedLeadIds.includes(apifyToLead(placeData, index)?.id); // Check if lead is already saved

    // Switch statement handles rendering for each column type
    switch (columnKey) {
      case 'site': { // Display website link and status
        const url = placeData.website;
        if (!url) return <span className="text-base-content/30">—</span>;
        // Check if website info is persisted in saved leads
        const savedLead = leadByIdMap.get(placeData.placeId || ''); // Assume placeId is the key
        const persistedUrl = savedLead?.website || url; // Use persisted URL if available
        const hostname = new URL(persistedUrl).hostname.replace('www.', '');
        return (
          <a href={persistedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-success hover:underline" title={persistedUrl}>
            <Globe className="w-3 h-3" /> {hostname}
          </a>
        );
      }
      case 'rank': return <span className="text-base-content/30 font-mono">{placeData.rank || index + 1}</span>; // Display rank or index
      case 'title': // Display business name and description
        return (
          <div className="min-w-[180px]">
            <span className="font-semibold text-base-content">{placeData.title || 'Unknown'}</span>
            {placeData.description && <div className="text-xs text-base-content/50 mt-0.5 truncate max-w-[250px]">{placeData.description}</div>}
          </div>
        );
      case 'score': { // Display lead score with visual indicator
        const score = audit.score;
        return (
          <div className="flex items-center gap-2">
            <div className="w-12 h-1.5 rounded-full bg-base-200 overflow-hidden">
              <div className={`h-full rounded-full ${score >= 7 ? 'bg-error' : score >= 4 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${score * 10}%` }} />
            </div>
            <span className={`font-bold text-sm ${getScoreColor(score)}`}>{score.toFixed(1)}</span>
          </div>
        );
      }
      case 'categoryName': // Display primary category
        return <span className="px-2 py-0.5 rounded bg-base-200 text-base-content/60 text-xs">{placeData.categoryName || '—'}</span>;
      case 'address': // Display address, truncated if long
        return <span className="text-xs text-base-content/60 max-w-[200px] truncate block">{placeData.address || '—'}</span>;
      case 'neighborhood': return <span className="text-xs text-base-content/40">{placeData.neighborhood || '—'}</span>;
      case 'city': return <span className="text-base-content/70">{placeData.city || '—'}</span>;
      case 'state': return <span className="text-base-content/70">{placeData.state || '—'}</span>;
      case 'postalCode': return <span className="text-base-content/40">{placeData.postalCode || '—'}</span>;
      case 'countryCode': return <span className="text-base-content/40">{placeData.countryCode || '—'}</span>;
      case 'phone': // Display phone number
        return placeData.phone ? (
          <span className="text-base-content/60 text-xs whitespace-nowrap">{placeData.phone}</span>
        ) : <span className="text-base-content/30">—</span>;
      case 'email': { // Display extracted emails
        const placeKey = placeData.placeId || placeData.title;
        const emails = emailMap[placeKey];
        if (!getExtractEmailUrl()) return <span className="text-base-content/30">—</span>; // Service not available
        if (emails === undefined) { // Status: loading
          return emailExtracting ? (
            <Loader2 className="w-3 h-3 animate-spin text-base-content/30" />
          ) : <span className="text-base-content/30">—</span>;
        }
        if (emails.length === 0) return <span className="text-base-content/30 text-xs">Not found</span>; // Status: not found
        // Display first 2 emails, indicate if more exist
        return (
          <div className="flex flex-col gap-0.5">
            {emails.slice(0, 2).map((em, i) => (
              <span key={i} className="text-success text-xs whitespace-nowrap">{em}</span>
            ))}
            {emails.length > 2 && <span className="text-base-content/40 text-[10px]">+{emails.length - 2} more</span>}
          </div>
        );
      }
      case 'website': // Display website link (cleaned hostname)
        return placeData.website ? (
          <a href={placeData.website} target="_blank" rel="noopener noreferrer" className="text-base-content/50 hover:text-base-content hover:underline text-xs truncate max-w-[150px] block">
            {new URL(placeData.website).hostname.replace('www.', '')}
          </a>
        ) : <span className="text-[10px] text-error/60">No Site</span>;
      case 'totalScore': // Display Google rating
        return placeData.totalScore ? (
          <div className="flex items-center gap-1">
            <Star className="w-3 h-3 text-warning fill-warning" />
            <span className="text-base-content/70 font-semibold">{placeData.totalScore}</span>
          </div>
        ) : <span className="text-base-content/30">—</span>;
      case 'reviewsCount': { // Display review count with quality indicator
        const count = placeData.reviewsCount || 0;
        return <span className={`font-mono text-sm ${count < 10 ? 'text-error' : count < 50 ? 'text-warning' : 'text-success'}`}>{count.toLocaleString()}</span>;
      }
      case 'claimThisBusiness': // Show GBP claimed status
        return placeData.claimThisBusiness === false ? (
          <span className="text-[10px] text-success flex items-center gap-1"><ShieldCheck size={11} />Unclaimed</span>
        ) : (
          <span className="text-[10px] text-primary flex items-center gap-1"><ShieldCheck size={11} />Claimed</span>
        );
      case 'price': return <span className="text-warning">{placeData.price || '—'}</span>; // Display price level
      case 'description': return <span className="text-xs text-base-content/50 max-w-[200px] truncate block">{placeData.description || '—'}</span>; // Display description
      case 'openingHours': { // Display opening hours (first day)
        const hours = placeData.openingHours;
        if (!hours || hours.length === 0) return <span className="text-base-content/30">—</span>;
        // Show first day's hours, full details on hover
        return <span className="text-xs text-base-content/50 max-w-[150px] truncate block" title={hours.map(h => `${h.day}: ${h.hours}`).join('\n')}>{hours[0]?.hours || '—'}</span>;
      }
      case 'categories': // Display all categories, truncated
        return <span className="text-xs text-base-content/50 max-w-[200px] truncate block">{(placeData.categories || []).join(', ') || '—'}</span>;
      case 'isAdvertisement': // Indicate if the listing is an ad
        return placeData.isAdvertisement ? (
          <span className="text-[10px] text-secondary">Yes</span>
        ) : <span className="text-base-content/30 text-[10px]">No</span>;
      case 'imagesCount': return <span className="text-base-content/60">{(placeData.imagesCount || 0).toLocaleString()}</span>; // Display image count
      case 'permanentlyClosed': // Indicate permanent closure status
        return placeData.permanentlyClosed ? <span className="text-error text-xs">Closed</span> : <span className="text-success text-xs">Open</span>;
      case 'temporarilyClosed': // Indicate temporary closure status
        return placeData.temporarilyClosed ? <span className="text-warning text-xs">Temp Closed</span> : <span className="text-base-content/30 text-xs">No</span>;
      case 'url': // Display Google Maps URL link
        return placeData.url ? <a href={placeData.url} target="_blank" rel="noopener noreferrer" className="text-base-content/40 hover:text-base-content hover:underline text-xs">Maps Link</a> : <span className="text-base-content/30">—</span>;
      case 'placeId': return <span className="text-xs text-base-content/40 font-mono truncate max-w-[100px] block">{placeData.placeId || '—'}</span>; // Display Place ID
      case 'issues': { // Display identified lead quality issues
        const issues = audit.issues;
        if (issues.length === 0) return <span className="text-success text-xs">None</span>;
        return (
          <div className="flex flex-wrap gap-1 max-w-[250px]">
            {issues.slice(0, 3).map((issue, j) => ( // Show first 3 issues
              <span key={j} className="px-1.5 py-0.5 rounded bg-error/5 text-error border border-error/10 text-[10px]">{issue.replace('Google ', '')}</span>
            ))}
            {issues.length > 3 && <span className="text-base-content/40 text-[10px]">+{issues.length - 3} more</span>}
          </div>
        );
      }
      default: return <span className="text-base-content/20">—</span>; // Default fallback
    }
  };

  return (
    <div className="space-y-6">
      {/* Inline error banner */}
      {bannerError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <span className="flex-1">{bannerError}</span>
          <button onClick={() => setBannerError(null)} className="ml-2 shrink-0 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-base-content flex items-center gap-2"><Search className="w-5 h-5 text-base-content/40" /> Find Leads</h1>
          <p className="text-base-content/40 mt-1 text-sm">Search Google Maps for local businesses</p>
        </div>
        {/* Action Buttons: Generate Sites & Download CSV */}
        <div className="flex gap-2">
          {results.length > 0 && typeof onGenerateSites === 'function' && (
            <button
              onClick={() => {
                // Determine which leads to process: selected or all results
                const indices = selectedRows.size > 0 ? [...selectedRows] : sortedResults.map((_, i) => i);
                const leadById = new Map((leads || []).map(l => [l.id, l])); // Map of already saved leads
                const leadsToProcess = indices
                  .map(i => sortedResults[i]) // Get place data for selected indices
                  .filter(Boolean) // Filter out any undefined/null entries
                  .map((place, i) => {
                    const fetchedLead = apifyToLead(place, i); // Convert Apify place to lead format
                    const emails = emailMap[place.placeId || place.title] || [];
                    if (emails.length > 0) fetchedLead.email = emails[0]; // Assign first extracted email
                    // Prioritize persisted lead data (if exists) over fresh fetched data
                    return leadById.get(fetchedLead.id) || fetchedLead;
                  });
                onGenerateSites(leadsToProcess); // Callback to parent component
              }}
              disabled={siteGen?.active} // Disable if site generation is already active
              className="btn btn-sm btn-primary font-medium"
              title={selectedRows.size > 0 ? `Generate sites for ${selectedRows.size} selected lead${selectedRows.size === 1 ? '' : 's'}` : `Generate sites for all ${results.length} leads`}
            >
              {siteGen?.active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              Generate Sites ({selectedRows.size > 0 ? selectedRows.size : results.length})
            </button>
          )}
          {results.length > 0 && (
            <button onClick={() => downloadCSV(sortedResults)} className="btn btn-sm border border-base-300 bg-base-100 hover:bg-base-200 text-base-content font-medium">
              <Download className="w-4 h-4" /> Download CSV ({results.length})
            </button>
          )}
        </div>
      </div>

      {/* Search Controls Section — sentence-style composer */}
      <div className="bg-base-100 rounded p-5 border border-base-300">
        {/* Top-left: Country dropdown (defaults to USA) */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="w-full max-w-xs">
            <label className="block text-xs text-base-content/50 mb-1 flex items-center gap-1">
              <Flag className="w-3.5 h-3.5" /> Country
            </label>
            <SearchableDropdown
              placeholder="Select country..."
              options={allCountries.map(c => c.name)}
              value={countryName || ''}
              onChange={(name) => {
                const match = allCountries.find(c => c.name === name);
                setCountry(match ? match.isoCode : '');
                setSelectedState('');
                setSelectedCity('');
                setZipCode('');
              }}
              searchPlaceholder="Search countries..."
            />
          </div>
        </div>

        {/* Sentence-style query — Profession → State → City → ZIP. Enter advances to the next field. */}
        <div className="flex flex-wrap items-center gap-2 text-base text-base-content/80 leading-loose">
          <Search className="w-5 h-5 text-base-content/40 flex-shrink-0" />
          <span className="font-medium">I'm looking for</span>

          {/* Profession / keyword */}
          <input
            ref={keywordRef}
            type="text"
            placeholder="Profession (e.g. Plumber)"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                stateRef.current?.focus();
                stateRef.current?.open();
              }
            }}
            className="input input-bordered h-9 px-3 text-sm min-w-[180px] flex-1 max-w-[260px]"
          />

          <span className="font-medium">in</span>

          {/* State / Province */}
          <div className="min-w-[160px] flex-1 max-w-[220px]">
            <SearchableDropdown
              ref={stateRef}
              placeholder={statesList.length > 0 ? 'State / Province' : 'Pick country first'}
              options={statesList.map(s => s.name)}
              value={stateName}
              onChange={(name) => {
                const match = statesList.find(s => s.name === name);
                setSelectedState(match ? match.isoCode : '');
                setSelectedCity('');
                setZipCode('');
                // Advance focus to City as soon as a state is picked.
                setTimeout(() => {
                  cityRef.current?.focus();
                  cityRef.current?.open();
                }, 50);
              }}
              disabled={statesList.length === 0}
              searchPlaceholder="Search states..."
            />
          </div>

          <span className="text-base-content/60">,</span>

          {/* City */}
          <div className="min-w-[160px] flex-1 max-w-[220px]">
            <SearchableDropdown
              ref={cityRef}
              placeholder={selectedState ? 'City' : 'Pick state first'}
              options={citiesList.map(c => c.name)}
              value={selectedCity}
              onChange={(name) => {
                setSelectedCity(name);
                setZipCode('');
                // Advance focus to ZIP — opens dropdown if API/offline returned options.
                setTimeout(() => {
                  zipRef.current?.focus?.();
                  zipRef.current?.open?.();
                }, 50);
              }}
              disabled={!selectedState && citiesList.length === 0}
              searchPlaceholder="Search cities..."
            />
          </div>

          <span className="text-base-content/60">,</span>

          {/* ZIP / Postal Code — dropdown when options are available (US offline, others via Zippopotam),
              spinner while fetching non-US, plain text input fallback when API can't supply codes. */}
          {zipLoading ? (
            <div className="inline-flex items-center gap-2 h-9 px-3 w-[180px] rounded border border-base-300 bg-base-200/50 text-sm text-base-content/50">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading ZIPs…
            </div>
          ) : zipApiSupported && zipOptions.length > 0 ? (
            <div className="w-[180px]">
              <SearchableDropdown
                ref={zipRef}
                placeholder="ZIP / PIN"
                options={zipOptions}
                value={zipCode}
                onChange={(code) => setZipCode(code)}
                disabled={!selectedCity}
                searchPlaceholder="Search ZIPs..."
              />
            </div>
          ) : (
            <input
              ref={zipRef}
              type="text"
              placeholder="ZIP / PIN"
              value={zipCode}
              onChange={e => setZipCode(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!loading && keyword.trim() && country && selectedState && zipCode.trim()) {
                    handleSearch();
                  }
                }
              }}
              className="input input-bordered h-9 px-3 text-sm w-[140px]"
            />
          )}

          {/* Search button.
              ZIP is now OPTIONAL (sir's two-mode refinement):
                • ZIP entered → single-ZIP search.
                • No ZIP but a city selected → whole-city background scrape.
              So enable when keyword+country+state are set AND (a ZIP is typed OR
              a city is selected). */}
          <button
            onClick={handleSearch}
            disabled={loading || !keyword.trim() || !country || !selectedState || (!zipCode.trim() && !selectedCity)}
            className="btn btn-primary h-9 min-h-0 px-4 text-sm font-medium flex items-center gap-2 ml-auto"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {zipCode.trim() ? 'Searching...' : 'Scraping city...'}</>
              : <><Search className="w-4 h-4" /> {zipCode.trim() ? 'Search Leads' : 'Scrape Whole City'}</>}
          </button>
        </div>

        {/* Charging Information Display */}
        {chargeInfo && (
          <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span className="text-base-content/70">
              <b>{chargeInfo.totalDelivered}</b> delivered · <b>{chargeInfo.extrasRemaining}</b> queued
              <span className="text-base-content/40 ml-1.5 font-normal">
                (Charged {chargeInfo.charged.toFixed(2)} credit{chargeInfo.charged === 1 ? '' : 's'} for {chargeInfo.delivered} new lead{chargeInfo.delivered === 1 ? '' : 's'}
                {chargeInfo.source === 'cache' && ' from cache'}
                {chargeInfo.source === 'extras' && ' from queue'}
                {chargeInfo.source === 'mixed' && ' queue + cache'}
                )
              </span>
            </span>
          </div>
        )}

        {/* Location Preview Chip */}
        {(location || zipCode) && (
          <div className="mt-3 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-base-content/30" />
            <span className="text-xs text-base-content/40">Searching in:</span>
            {zipCode.trim() ? (
               // Display ZIP code and country if provided
              <span className="text-xs font-medium text-base-content bg-base-200 px-2.5 py-1 rounded">ZIP: {zipCode.trim()}{countryName ? `, ${countryName}` : ''}</span>
            ) : (
              // Display combined location string
              <span className="text-xs font-medium text-base-content bg-base-200 px-2.5 py-1 rounded">{location}</span>
            )}
          </div>
        )}

        {/* Loading / Progress Indicator */}
        {loading && (
          <div className="mt-4 p-3 bg-base-200 border border-base-300 rounded">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-base-content/40" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm text-base-content font-medium">{progress}</p>
                  {cacheModeRef.current && ( // Indicate if using cache
                    <span className="text-xs text-success font-medium">Cache hit</span>
                  )}
                </div>
                <p className="text-xs text-base-content/40 font-mono">Elapsed: {elapsed}s</p>
              </div>
              <button onClick={handleCancel} className="btn btn-xs btn-error btn-outline">Cancel</button>
            </div>
            {/* Whole-city scrape progress bar (Mode 2). */}
            {cityJob && cityJob.zipsTotal > 0 && (() => {
              const tgt = cityJob.targetLeads || 100;
              const pool = cityJob.poolLeads || 0;
              const pct = Math.min(100, Math.round((pool / tgt) * 100));
              return (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1 text-xs text-base-content/50">
                    <span>{Math.min(pool, tgt)}/{tgt} leads · {cityJob.zipsDone}/{cityJob.zipsTotal} ZIPs</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-base-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Site Generation Progress Bar */}
      {siteGen?.active && siteGen.total > 0 && (
        <div className="bg-base-100 rounded p-4 border border-primary/40">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-primary font-medium">
                  Generating sites... {siteGen.completed}/{siteGen.total}
                  {siteGen.current ? <span className="text-base-content/60 font-normal"> — {siteGen.current}</span> : null}
                </p>
                {typeof onCancelSiteGen === 'function' && (
                  <button onClick={onCancelSiteGen} className="btn btn-xs btn-ghost text-base-content/50">Cancel</button>
                )}
              </div>
              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-base-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${(siteGen.completed / siteGen.total) * 100}%` }}
                />
              </div>
              {siteGen.errors?.length > 0 && ( // Display error count if any occurred
                <p className="text-xs text-error mt-1">{siteGen.errors.length} error{siteGen.errors.length === 1 ? '' : 's'} so far</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Email Extraction Progress Bar */}
      {emailExtracting && emailProgress.total > 0 && (
        <div className="bg-base-100 rounded p-4 border border-base-300">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-success" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-success font-medium">
                  Extracting emails... {emailProgress.completed}/{emailProgress.total} ({emailProgress.found} found)
                </p>
                <button onClick={() => emailCancelRef.current = true} className="btn btn-xs btn-ghost text-base-content/50">Cancel</button>
              </div>
              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-base-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all duration-300"
                  style={{ width: `${(emailProgress.completed / emailProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Picker Toggle */}
      {results.length > 0 && (
        <div className="relative">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowColPicker(!showColPicker)}
              className="btn btn-sm btn-ghost border border-base-300 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Columns ({visibleCols.length}/{ALL_COLUMNS.length})
              {showColPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {/* Display result count confirmation */}
            <span className="text-sm text-base-content/40 font-mono">
              {chargeInfo?.poolSize > results.length 
                ? `Showing ${results.length} out of ${chargeInfo.poolSize} total found` 
                : `${results.length} results found`} (auto-saved)
            </span>
          </div>
          {/* Column Picker Dropdown */}
          {showColPicker && (
            <div className="absolute z-50 top-10 left-0 bg-base-100 border border-base-300 rounded p-4 shadow-lg grid grid-cols-3 gap-2 min-w-[500px]">
              {/* Quick select buttons */}
              <div className="col-span-3 flex gap-2 mb-2 border-b border-base-300 pb-2">
                <button onClick={() => setVisibleCols(ALL_COLUMNS.map(c => c.key))} className="text-xs text-base-content hover:underline">Show All</button>
                <button onClick={() => setVisibleCols(DEFAULT_VISIBLE)} className="text-xs text-secondary hover:underline">Reset Default</button>
                <button onClick={() => setVisibleCols(['rank', 'title', 'score'])} className="text-xs text-base-content/40 hover:underline">Minimal</button>
              </div>
              {/* Checkboxes for each column */}
              {ALL_COLUMNS.map(col => (
                <label key={col.key} className="flex items-center gap-2 text-xs text-base-content/80 cursor-pointer hover:bg-base-200 rounded px-2 py-1">
                  <input type="checkbox" checked={visibleCols.includes(col.key)}
                    onChange={() => setVisibleCols(prev => prev.includes(col.key) ? prev.filter(c => c !== col.key) : [...prev, col.key])}
                    className="checkbox checkbox-xs" />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="bg-base-100 rounded border border-base-300 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr className="bg-base-200">
                  {/* Checkbox header for selecting all rows */}
                  <th className="w-8">
                    <input type="checkbox" checked={selectedRows.size === sortedResults.length && sortedResults.length > 0}
                      onChange={toggleSelectAll} className="checkbox checkbox-xs" />
                  </th>
                  {/* Dynamically render column headers based on visibility */}
                  {ALL_COLUMNS.filter(c => visibleCols.includes(c.key)).map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)}
                      className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wider cursor-pointer hover:text-base-content transition-colors" style={{ fontFamily: "'Inter',sans-serif", color: '#9CA3AF' }}>
                      <div className="flex items-center gap-1">
                        {col.label}
                        {/* Show sort direction icon */}
                        {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </div>
                    </th>
                  ))}
                  <th className="text-center text-[10px] font-medium uppercase tracking-wider" style={{ fontFamily: "'Inter',sans-serif", color: '#9CA3AF' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* Render table rows for paginated results */}
                {paginatedResults.map((place, index) => {
                  // Convert Apify place data to lead object, get emails, check if saved
                  const lead = apifyToLead(place, index);
                  const isSaved = savedLeadIds.includes(lead.id);
                  const placeKey = place.placeId || place.title;
                  const isSelected = selectedRows.has(placeKey);
                  return (
                    <tr key={place.placeId || index}
                      className={`hover:bg-base-200/30 transition-colors border-b border-base-200 last:border-0 ${isSelected ? 'bg-base-200/40' : ''}`}>
                      {/* Row selection checkbox */}
                      <td className="px-3">
                        <input type="checkbox" checked={isSelected}
                          onChange={() => setSelectedRows(prev => { // Toggle selection state
                            const next = new Set(prev);
                            next.has(placeKey) ? next.delete(placeKey) : next.add(placeKey);
                            return next;
                          })}
                          className="checkbox checkbox-xs" />
                      </td>
                      {/* Render visible columns */}
                      {ALL_COLUMNS.filter(c => visibleCols.includes(c.key)).map(col => (
                        <td key={col.key} className="px-3 py-2.5">{renderCell(place, col.key, index)}</td>
                      ))}
                      {/* Action buttons cell */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-center">
                          {/* View Audit button */}
                          <button onClick={() => {
                            const emails = emailMap[place.placeId || place.title] || [];
                            if (emails.length > 0) lead.email = emails[0]; // Assign first extracted email
                            onViewLead(lead); // Callback to view lead details
                          }} className="btn btn-ghost btn-xs btn-square hover:bg-base-200" title="View Audit">
                            <Eye className="w-4 h-4" />
                          </button>
                          {/* Saved status indicator */}
                          {isSaved ? (
                            <span className="p-1.5 text-success" title="Saved"><CheckCircle className="w-4 h-4" /></span>
                          ) : (
                            // Show loading indicator while auto-saving
                            <span className="p-1.5 text-base-content/20" title="Saving..."><Loader2 className="w-4 h-4 animate-spin" /></span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {sortedResults.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-1 py-3 text-sm bg-base-200/50 border-t border-base-300">
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                      className="btn btn-sm btn-ghost">Prev</button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                      className="btn btn-sm btn-ghost">Next</button>
              <span className="ml-3 text-base-content/50">
                Page {safePage} of {totalPages} · {sortedResults.length} leads
              </span>
            </div>
          )}
        </div>
      )}

      {/* Empty State: Displayed when no results are found */}
      {!loading && results.length === 0 && (
        <div className="text-center py-20 bg-base-100 rounded border border-base-300">
          {/* Placeholder graphic */}
          <div className="w-14 h-14 bg-base-200 rounded flex items-center justify-center mx-auto mb-6">
            <Search className="w-7 h-7 text-base-content/30" />
          </div>
          <h3 className="text-xl font-bold text-base-content">Search for Local Business Leads</h3>
          <p className="text-base-content/40 mt-2 max-w-md mx-auto text-sm">Enter a business type and location above to find leads from Google Maps. Use the column picker to customize your view.</p>
          {/* Example search terms */}
          <div className="mt-8 flex flex-wrap gap-2 justify-center">
            {['Plumber', 'Dentist', 'Restaurant', 'Hair Salon', 'Lawyer', 'Real Estate'].map(exampleKeyword => (
              <button key={exampleKeyword} onClick={() => setKeyword(exampleKeyword)}
                className="btn btn-sm btn-ghost border border-base-300 rounded px-4">{exampleKeyword}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
