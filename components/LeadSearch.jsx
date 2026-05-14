import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Search, MapPin, Filter, ChevronDown, ChevronUp, Star, Globe, Phone, Plus, Eye, AlertTriangle, Loader2, Download, Save, CheckCircle, Hash, Clock, Image, Tag, ExternalLink, ShieldCheck, ShieldX, MapPinned, Building, DollarSign, Bookmark, Mail, Flag } from 'lucide-react';
import { getScoreColor, getScoreLabel } from '../utils/helpers.js';
import { extractEmailForUrl, getExtractEmailUrl } from '../utils/emailExtractor.js';
import { COUNTRIES, getStates, getCities } from '../utils/indiaData.js';
import SearchableDropdown from './SearchableDropdown.jsx';

// Use the local PHP proxy for all Apify tasks
// to securely keep API keys hidden on the backend.
// LOCAL TEST: on localhost we hit a local PHP server at :8000 so we can verify
// the cache layer before deploying. Revert this block before pushing to prod.
const APIFY_PROXY_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000/apify-proxy.php'
  : '/apify-proxy.php';

/* Scoring logic */
function computeLeadScore(p) {
  let score = 0;
  const issues = [];
  const gbp_claimed = p.claimThisBusiness === false;
  if (!gbp_claimed) { score += 25; issues.push('Google Business Profile is unclaimed'); }
  const has_website = !!p.website && p.website.length > 5;
  if (!has_website) { score += 20; issues.push('No website found'); }
  const has_ssl = has_website && (p.website || '').startsWith('https');
  if (has_website && !has_ssl) { score += 10; issues.push('Website missing SSL certificate'); }
  const mobile_responsive = has_website && has_ssl;
  if (has_website && !mobile_responsive) { score += 5; issues.push('Website may not be mobile responsive'); }
  const reviewCount = p.reviewsCount || 0;
  if (reviewCount === 0) { score += 20; issues.push('No Google reviews'); }
  else if (reviewCount < 10) { score += 15; issues.push('Very few Google reviews (under 10)'); }
  else if (reviewCount < 25) { score += 10; issues.push('Low Google review count (under 25)'); }
  else if (reviewCount < 50) { score += 5; issues.push('Below average review count'); }
  const rating = p.totalScore || 0;
  if (rating > 0 && rating < 3.5) { score += 10; issues.push('Low Google rating (below 3.5)'); }
  else if (rating >= 3.5 && rating < 4.0) { score += 5; issues.push('Average Google rating'); }
  const has_social = false;
  if (!has_social) { score += 5; issues.push('No social media presence detected'); }
  const running_ads = p.isAdvertisement === true;
  let review_sentiment = 'none';
  if (reviewCount > 0) {
    if (rating >= 4.5) review_sentiment = 'positive';
    else if (rating >= 3.5) review_sentiment = 'mixed';
    else review_sentiment = 'negative';
  }
  return { score: Math.min(score / 10, 10), gbp_claimed, has_website, mobile_responsive, has_ssl, has_social, running_ads, review_sentiment, issues };
}

/* Convert Apify place to Lead */
function apifyToLead(p, idx) {
  const audit = computeLeadScore(p);
  return {
    id: p.placeId || `apify-${idx}-${Date.now()}`,
    business_name: p.title || 'Unknown',
    address: p.address || '',
    city: p.city || '',
    state: p.state || '',
    phone: p.phone || '',
    email: '',
    website: p.website || '',
    category: p.categoryName || (p.categories || [])[0] || '',
    rating: p.totalScore || 0,
    review_count: p.reviewsCount || 0,
    score: audit.score,
    status: 'new',
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
    is_advertinement: p.isAdvertisement || false,
    // Raw Apify fields for Google Sheets storage
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
      ClaimThisBusiness: p.claimThisBusiness === false ? 'false' : 'true',
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
      IsAdvertisement: p.isAdvertisement ? 'true' : 'false',
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

/* Visible columns config */
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

export default function LeadSearch({ onViewLead, onSaveLead, onBulkSaveLeads, savedLeadIds, leads = [], onGenerateSites, siteGen, onCancelSiteGen }) {
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  // Derive location string from cascading selections
  const location = useMemo(() => {
    const parts = [];
    if (selectedCity) parts.push(selectedCity);
    if (selectedState) parts.push(selectedState);
    if (country) parts.push(country);
    return parts.join(', ');
  }, [country, selectedState, selectedCity]);


  // Memoize states and cities lists
  const statesList = useMemo(() => {
    const c = COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase().trim() || c.code.toLowerCase() === country.toLowerCase().trim());
    return c ? getStates(c.code) : [];
  }, [country]);

  const citiesList = useMemo(() => {
    const c = COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase().trim() || c.code.toLowerCase() === country.toLowerCase().trim());
    return c && selectedState ? getCities(c.code, selectedState) : [];
  }, [country, selectedState]);

  const [zipCode, setZipCode] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [servedFromCache, setServedFromCache] = useState(false);
  const [progress, setProgress] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [visibleCols, setVisibleCols] = useState(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [emailMap, setEmailMap] = useState({}); // placeId -> emails[]
  const [emailExtracting, setEmailExtracting] = useState(false);
  const [emailProgress, setEmailProgress] = useState({ completed: 0, total: 0, found: 0 });
  const timerRef = useRef(null);
  const cancelRef = useRef(false);
  const emailCancelRef = useRef(false);
  const cacheModeRef = useRef(false); // tracks if current search is using cached data

  /* Email extraction — runs 3 concurrent workers after search */
  const startEmailExtraction = useCallback(async (places) => {
    const endpoint = getExtractEmailUrl();
    if (!endpoint) return; // localhost — skip

    const withWebsite = places.filter(p => p.website && p.website.length > 5);
    if (withWebsite.length === 0) return;

    setEmailExtracting(true);
    emailCancelRef.current = false;
    setEmailProgress({ completed: 0, total: withWebsite.length, found: 0 });

    let completed = 0;
    let found = 0;
    const queue = [...withWebsite];

    const worker = async () => {
      while (queue.length > 0 && !emailCancelRef.current) {
        const place = queue.shift();
        if (!place) break;
        try {
          const result = await extractEmailForUrl(place.website);
          const id = place.placeId || place.title;
          if (result.emails.length > 0) {
            found += result.emails.length;
            setEmailMap(prev => ({ ...prev, [id]: result.emails }));
          } else {
            setEmailMap(prev => ({ ...prev, [id]: [] }));
          }
        } catch {
          // ignore individual failures
        }
        completed++;
        setEmailProgress({ completed, total: withWebsite.length, found });
      }
    };

    // Run 3 workers concurrently
    await Promise.all([worker(), worker(), worker()]);
    setEmailExtracting(false);
  }, []);

  /* Apify async search */
  const handleSearch = async () => {
    if (!keyword.trim() || !country.trim() || !selectedState.trim() || !zipCode.trim()) return;
    setLoading(true);
    setResults([]);
    setProgress('Preparing search parameters...');
    setServedFromCache(false);
    cacheModeRef.current = false;
    setElapsed(0);
    setSelectedRows(new Set());
    setEmailMap({});
    setEmailExtracting(false);
    setEmailProgress({ completed: 0, total: 0, found: 0 });
    cancelRef.current = false;
    emailCancelRef.current = true;
    const start = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);

    try {
      setProgress('Starting Google Maps scraper...');

      // Build the request body — use postalCode + countryCode for zip-based search
      const requestBody = {
        searchStringsArray: [keyword.trim()],
        language: "en",
        maxReviews: 0,
        maxImages: 0
      };

      if (zipCode.trim()) {
        // When ZIP code is provided, use discrete geo fields for precise area search
        requestBody.postalCode = zipCode.trim();
        // Extract country code for the postalCode field
        const countryObj = COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase().trim() || c.code.toLowerCase() === country.toLowerCase().trim());
        if (countryObj) {
          requestBody.countryCode = countryObj.code.toLowerCase();
        }
        // Don't use locationQuery when using postalCode — set a high limit to get ALL results
        requestBody.maxCrawledPlacesPerSearch = 9999;
      } else {
        // Fallback to location-based search with a generous limit
        requestBody.locationQuery = location.trim();
        requestBody.maxCrawledPlacesPerSearch = 500;
      }

      const runRes = await fetch(`${APIFY_PROXY_URL}?action=run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!runRes.ok) {
        const errData = await runRes.json();
        throw new Error(errData?.error?.message || `Failed to start Apify run (${runRes.status})`);
      }

      const runData = await runRes.json();
      const runId = runData?.data?.id;
      const datasetId = runData?.data?.defaultDatasetId;
      const cached = runData?._cached === true;
      cacheModeRef.current = cached; // sync — badge reads from ref
      setServedFromCache(cached);
      if (!runId || !datasetId) throw new Error('Failed to capture run metadata');

      const searchLabel = zipCode.trim() ? `ZIP ${zipCode.trim()}` : `"${location}"`;
      setProgress(cached
        ? `Fetching cached results for "${keyword}" in ${searchLabel}...`
        : `Scraping Google Maps for "${keyword}" in ${searchLabel}...`);
      let status = 'RUNNING';
      let attempts = 0;

      while ((status === 'RUNNING' || status === 'READY') && attempts < 180 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;
        setProgress(`Scraping in progress... (poll ${attempts})`);

        const pollRes = await fetch(`${APIFY_PROXY_URL}?action=check&runId=${runId}`);
        if (!pollRes.ok) continue;

        const pollData = await pollRes.json();
        status = pollData?.data?.status || 'UNKNOWN';
        if (pollData?.data?.statusMessage) {
          setProgress(`${status}: ${pollData.data.statusMessage.substring(0, 100)}`);
        }
      }

      if (cancelRef.current) {
        setProgress('Search cancelled');
        return;
      }

      if (status !== 'SUCCEEDED') {
        throw new Error(`Scraper run ended with status: ${status}. Check Apify dashboard for details.`);
      }

      setProgress('Fetching results from dataset...');
      const dataRes = await fetch(`${APIFY_PROXY_URL}?action=dataset&datasetId=${datasetId}&runId=${runId}&limit=9999`);
      if (!dataRes.ok) throw new Error(`Failed to fetch results (${dataRes.status})`);

      let rawData = await dataRes.json();
      if (rawData.error || rawData.success === false) {
        throw new Error(rawData.error?.message || rawData.message || rawData.error || 'Dataset fetch failed');
      }

      let places = Array.isArray(rawData) ? rawData : (rawData.items || rawData.data || []);

      if (!Array.isArray(places)) {
        throw new Error('Apify Dataset API returned an invalid non-array format: ' + JSON.stringify(rawData).substring(0, 50));
      }

      places.forEach((p, i) => { if (!p.rank) p.rank = i + 1; });

      setResults(places);
      setProgress(cached
        ? `Found ${places.length} businesses (served from cache, no API cost)`
        : `Found ${places.length} businesses!`);
      // Auto-start email extraction in background
      startEmailExtraction(places);

      // Auto-save all leads to Lead Management
      const allLeads = places.map((p, i) => apifyToLead(p, i));
      const savedSet = new Set(savedLeadIds || []);
      const leadsToSave = allLeads.filter(l => !savedSet.has(l.id));

      console.log('[LeadSearch] auto-save trigger →', {
        placesFound: places.length,
        alreadySavedIds: savedLeadIds?.length || 0,
        toSave: leadsToSave.length,
        hasCallback: typeof onBulkSaveLeads === 'function',
        firstThreeIds: leadsToSave.slice(0, 3).map(l => l.id),
      });

      if (typeof onBulkSaveLeads !== 'function') {
        console.error('[LeadSearch] onBulkSaveLeads prop is missing — cannot persist leads');
      } else if (leadsToSave.length > 0) {
        onBulkSaveLeads(leadsToSave);
      } else {
        console.warn('[LeadSearch] nothing new to save (all results already in savedLeadIds)');
      }
    } catch (err) {
      console.error('Search error:', err);
      setProgress(`Error: ${err.message}`);
      alert(`Search Error: ${err.message}`);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setLoading(false);
    }
  };

  /* Sorting */
  const sortedResults = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      let av, bv;
      if (sortKey === 'score') {
        av = computeLeadScore(a).score;
        bv = computeLeadScore(b).score;
      } else {
        av = a[sortKey]; bv = b[sortKey];
      }
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [results, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  /* CSV Download */
  const downloadCSV = (places) => {
    const headers = [
      'Rank', 'Business Name', 'Lead Score', 'Email', 'Description', 'Price', 'Category', 'All Categories',
      'Address', 'Neighborhood', 'Street', 'City', 'State', 'Zip', 'Country',
      'Phone', 'Phone Unformatted', 'Website', 'Has SSL', 'Rating', 'Reviews', 'Images Count',
      'GBP Claimed', 'Permanently Closed', 'Temporarily Closed',
      'Running Ads', 'Opening Hours', 'Place ID', 'Google Maps URL',
      'Latitude', 'Longitude', 'Issues Found', 'Scraped At'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const s = String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = places.map((p, i) => {
      const audit = computeLeadScore(p);
      const placeEmails = emailMap[p.placeId || p.title] || [];
      const fields = [
        p.rank || i + 1,
        p.title || '',
        audit.score,
        placeEmails.join('; '),
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
        p.phone || '',
        p.phoneUnformatted || '',
        p.website || '',
        (p.website || '').startsWith('https') ? 'Yes' : 'No',
        p.totalScore || '',
        p.reviewsCount || 0,
        p.imagesCount || 0,
        p.claimThisBusiness === false ? 'Yes' : 'No', // GBP Claimed
        p.permanentlyClosed ? 'Yes' : 'No',
        p.temporarilyClosed ? 'Yes' : 'No',
        p.isAdvertisement ? 'Yes' : 'No',
        (p.openingHours || []).map(h => `${h.day}: ${h.hours}`).join('; '),
        p.placeId || '',
        p.url || '',
        p.location?.lat || '',
        p.location?.lng || '',
        audit.issues.join('; '),
        p.scrapedAt || ''
      ];
      return fields.map(escapeCsv).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_${keyword.replace(/\s+/g, '_')}_${location.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* Select all / none */
  const toggleSelectAll = () => {
    if (selectedRows.size === sortedResults.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(sortedResults.map((_, i) => i)));
  };

  /* Save selected leads — single bulk API call */
  const saveSelectedLeads = () => {
    const leadsToSave = [];
    selectedRows.forEach(i => {
      const lead = apifyToLead(sortedResults[i], i);
      const emails = emailMap[sortedResults[i].placeId || sortedResults[i].title] || [];
      if (emails.length > 0) lead.email = emails[0];
      if (!savedLeadIds.includes(lead.id)) leadsToSave.push(lead);
    });
    if (leadsToSave.length > 0) onBulkSaveLeads(leadsToSave);
  };

  /* Save all leads — single bulk API call */
  const saveAllLeads = () => {
    const leadsToSave = [];
    sortedResults.forEach((p, i) => {
      const lead = apifyToLead(p, i);
      const emails = emailMap[p.placeId || p.title] || [];
      if (emails.length > 0) lead.email = emails[0];
      if (!savedLeadIds.includes(lead.id)) leadsToSave.push(lead);
    });
    if (leadsToSave.length > 0) onBulkSaveLeads(leadsToSave);
  };

  /* Render cell value */
  const leadByPlaceId = useMemo(() => {
    const m = new Map();
    (leads || []).forEach(l => { if (l.id) m.set(l.id, l); });
    return m;
  }, [leads]);

  const renderCell = (p, col, idx) => {
    const audit = computeLeadScore(p);
    switch (col) {
      case 'site': {
        const saved = leadByPlaceId.get(p.placeId || '');
        const short = saved?.tier1_short || saved?.tier2_short || saved?.tier3_short;
        const raw   = saved?.tier1 || saved?.tier2 || saved?.tier3;
        const url   = short || raw;
        if (!url) return <span className="text-base-content/30">—</span>;
        return (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-success hover:underline" title={raw || url}>
            <Globe className="w-3 h-3" /> Site
          </a>
        );
      }
      case 'rank': return <span className="text-base-content/30 font-mono">{p.rank || idx + 1}</span>;
      case 'title':
        return (
          <div className="min-w-[180px]">
            <span className="font-semibold text-base-content">{p.title || 'Unknown'}</span>
            {p.description && <div className="text-xs text-base-content/50 mt-0.5 truncate max-w-[250px]">{p.description}</div>}
          </div>
        );
      case 'score': {
        const s = audit.score;
        return (
          <div className="flex items-center gap-2">
            <div className="w-12 h-1.5 rounded-full bg-base-200 overflow-hidden">
              <div className={`h-full rounded-full ${s >= 70 ? 'bg-error' : s >= 40 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${s}%` }} />
            </div>
            <span className={`font-bold text-sm ${getScoreColor(s)}`}>{s}</span>
          </div>
        );
      }
      case 'categoryName': return <span className="px-2 py-0.5 rounded bg-base-200 text-base-content/60 text-xs">{p.categoryName || '—'}</span>;
      case 'address': return <span className="text-xs text-base-content/60 max-w-[200px] truncate block">{p.address || '—'}</span>;
      case 'neighborhood': return <span className="text-xs text-base-content/40">{p.neighborhood || '—'}</span>;
      case 'city': return <span className="text-base-content/70">{p.city || '—'}</span>;
      case 'state': return <span className="text-base-content/70">{p.state || '—'}</span>;
      case 'postalCode': return <span className="text-base-content/40">{p.postalCode || '—'}</span>;
      case 'countryCode': return <span className="text-base-content/40">{p.countryCode || '—'}</span>;
      case 'phone':
        return p.phone ? (
          <span className="text-base-content/60 text-xs whitespace-nowrap">{p.phone}</span>
        ) : <span className="text-base-content/30">—</span>;
      case 'email': {
        const placeKey = p.placeId || p.title;
        const emails = emailMap[placeKey];
        if (!getExtractEmailUrl()) return <span className="text-base-content/30">—</span>;
        if (emails === undefined) {
          return emailExtracting ? (
            <Loader2 className="w-3 h-3 animate-spin text-base-content/30" />
          ) : <span className="text-base-content/30">—</span>;
        }
        if (emails.length === 0) return <span className="text-base-content/30 text-xs">Not found</span>;
        return (
          <div className="flex flex-col gap-0.5">
            {emails.slice(0, 2).map((em, i) => (
              <span key={i} className="text-success text-xs whitespace-nowrap">{em}</span>
            ))}
            {emails.length > 2 && <span className="text-base-content/40 text-[10px]">+{emails.length - 2} more</span>}
          </div>
        );
      }
      case 'website':
        return p.website ? (
          <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-base-content/50 hover:text-base-content hover:underline text-xs truncate max-w-[150px] block">
            {new URL(p.website).hostname.replace('www.', '')}
          </a>
        ) : <span className="text-[10px] text-error/60">No Site</span>;
      case 'totalScore':
        return p.totalScore ? (
          <div className="flex items-center gap-1">
            <Star className="w-3 h-3 text-warning fill-warning" />
            <span className="text-base-content/70 font-semibold">{p.totalScore}</span>
          </div>
        ) : <span className="text-base-content/30">—</span>;
      case 'reviewsCount': {
        const rc = p.reviewsCount || 0;
        return <span className={`font-mono text-sm ${rc < 10 ? 'text-error' : rc < 50 ? 'text-warning' : 'text-success'}`}>{rc.toLocaleString()}</span>;
      }
      case 'claimThisBusiness':
        return p.claimThisBusiness === false ? (
          <span className="text-[10px] text-success flex items-center gap-1"><ShieldCheck size={11} />Claimed</span>
        ) : (
          <span className="text-[10px] text-error flex items-center gap-1"><ShieldX size={11} />Unclaimed</span>
        );
      case 'price': return <span className="text-warning">{p.price || '—'}</span>;
      case 'description': return <span className="text-xs text-base-content/50 max-w-[200px] truncate block">{p.description || '—'}</span>;
      case 'openingHours': {
        const hrs = p.openingHours;
        if (!hrs || hrs.length === 0) return <span className="text-base-content/30">—</span>;
        return <span className="text-xs text-base-content/50 max-w-[150px] truncate block" title={hrs.map(h => `${h.day}: ${h.hours}`).join('\n')}>{hrs[0]?.hours || '—'}</span>;
      }
      case 'categories':
        return <span className="text-xs text-base-content/50 max-w-[200px] truncate block">{(p.categories || []).join(', ') || '—'}</span>;
      case 'isAdvertisement':
        return p.isAdvertisement ? (
          <span className="text-[10px] text-secondary">Yes</span>
        ) : <span className="text-base-content/30 text-[10px]">No</span>;
      case 'imagesCount': return <span className="text-base-content/60">{(p.imagesCount || 0).toLocaleString()}</span>;
      case 'permanentlyClosed':
        return p.permanentlyClosed ? <span className="text-error text-xs">Closed</span> : <span className="text-success text-xs">Open</span>;
      case 'temporarilyClosed':
        return p.temporarilyClosed ? <span className="text-warning text-xs">Temp Closed</span> : <span className="text-base-content/30 text-xs">No</span>;
      case 'url':
        return p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-base-content/40 hover:text-base-content hover:underline text-xs">Maps Link</a> : <span className="text-base-content/30">—</span>;
      case 'placeId': return <span className="text-xs text-base-content/40 font-mono truncate max-w-[100px] block">{p.placeId || '—'}</span>;
      case 'issues': {
        const iss = audit.issues;
        if (iss.length === 0) return <span className="text-success text-xs">None</span>;
        return (
          <div className="flex flex-wrap gap-1 max-w-[250px]">
            {iss.slice(0, 3).map((issue, j) => (
              <span key={j} className="px-1.5 py-0.5 rounded bg-error/5 text-error border border-error/10 text-[10px]">{issue.replace('Google ', 'G')}</span>
            ))}
            {iss.length > 3 && <span className="text-base-content/40 text-[10px]">+{iss.length - 3} more</span>}
          </div>
        );
      }
      default: return <span className="text-base-content/20">—</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-base-content flex items-center gap-2"><Search className="w-5 h-5 text-base-content/40" /> Find Leads</h1>
          <p className="text-base-content/40 mt-1 text-sm">Search Google Maps for local businesses via Apify</p>
        </div>
        <div className="flex gap-2">
          {results.length > 0 && typeof onGenerateSites === 'function' && (
            <button
              onClick={() => {
                // Use selected rows if any, else all results. Map to saved-lead objects (so Tier writes use the persisted PlaceId).
                const indices = selectedRows.size > 0 ? [...selectedRows] : sortedResults.map((_, i) => i);
                const leadById = new Map((leads || []).map(l => [l.id, l]));
                const picked = indices
                  .map(i => sortedResults[i])
                  .filter(Boolean)
                  .map((p, i) => {
                    const apifyLead = apifyToLead(p, i);
                    const emails = emailMap[p.placeId || p.title] || [];
                    if (emails.length > 0) apifyLead.email = emails[0];
                    // Prefer the persisted lead (has CreatedAt, status, etc.); fall back to fresh one.
                    return leadById.get(apifyLead.id) || apifyLead;
                  });
                onGenerateSites(picked);
              }}
              disabled={siteGen?.active}
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

      {/* Search Controls */}
      <div className="bg-base-100 rounded p-5 border border-base-300">
        {/* Row 1: Keyword + Country + State */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-base-content/60 mb-1">Business Type / Keyword</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input type="text" placeholder="e.g. Plumber, Dentist, Restaurant..." value={keyword} onChange={e => setKeyword(e.target.value)}
                className="input input-bordered w-full pl-10 h-10 text-sm"
                onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-base-content/60 mb-1">Country</label>
            <div className="relative">
              <Flag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input type="text" placeholder="e.g. India, United States..." value={country} onChange={e => {
                setCountry(e.target.value);
                setSelectedState('');
                setSelectedCity('');
              }}
                className="input input-bordered w-full pl-10 h-10 text-sm"
                onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
            </div>
          </div>
          {statesList.length > 0 ? (
            <SearchableDropdown
              label="State / Province"
              icon={MapPinned}
              placeholder="Select state..."
              options={statesList}
              value={selectedState}
              onChange={(val) => {
                setSelectedState(val);
                setSelectedCity('');
              }}
              searchPlaceholder="Search states..."
            />
          ) : (
            <div>
              <label className="block text-sm text-base-content/60 mb-1">State / Province</label>
              <div className="relative">
                <MapPinned className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
                <input type="text" placeholder="e.g. California, Ontario..." value={selectedState} onChange={e => setSelectedState(e.target.value)}
                  className="input input-bordered w-full pl-10 h-10 text-sm"
                  onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
              </div>
            </div>
          )}
        </div>

        {/* Row 2: City + Max Results + Search Button */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {statesList.length > 0 ? (
            <SearchableDropdown
              label="City"
              icon={MapPin}
              placeholder={selectedState ? 'Select city...' : 'Select state first'}
              options={citiesList}
              value={selectedCity}
              onChange={setSelectedCity}
              disabled={!selectedState}
              searchPlaceholder="Search cities..."
            />
          ) : (
            <div>
              <label className="block text-sm text-base-content/60 mb-1">City</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
                <input type="text" placeholder="e.g. Los Angeles, London..." value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
                  className="input input-bordered w-full pl-10 h-10 text-sm"
                  onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm text-base-content/60 mb-1">ZIP / Postal Code</label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input type="text" placeholder="e.g. 10001, 400001..." value={zipCode} onChange={e => setZipCode(e.target.value)}
                className="input input-bordered w-full pl-10 h-10 text-sm"
                onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={handleSearch} disabled={loading || !keyword.trim() || !country.trim() || !selectedState.trim() || !zipCode.trim()}
              className="btn btn-primary w-full h-10 min-h-0 font-medium flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Searching...</> : <><Search className="w-4 h-4" /> Search Leads</>}
            </button>
          </div>
        </div>

        {/* Location preview chip */}
        {(location || zipCode) && (
          <div className="mt-3 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-base-content/30" />
            <span className="text-xs text-base-content/40">Searching in:</span>
            {zipCode.trim() ? (
              <span className="text-xs font-medium text-base-content bg-base-200 px-2.5 py-1 rounded">ZIP: {zipCode.trim()}{country ? `, ${country}` : ''}</span>
            ) : (
              <span className="text-xs font-medium text-base-content bg-base-200 px-2.5 py-1 rounded">{location}</span>
            )}
          </div>
        )}

        {loading && (
          <div className="mt-4 p-3 bg-base-200 border border-base-300 rounded">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-base-content/40" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm text-base-content font-medium">{progress}</p>
                  {cacheModeRef.current && (
                    <span className="text-xs text-success font-medium">Getting data from cache…</span>
                  )}
                </div>
                <p className="text-xs text-base-content/40 font-mono">Elapsed: {elapsed}s</p>
              </div>
              <button onClick={() => cancelRef.current = true} className="btn btn-xs btn-error btn-outline">Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Site Generation Progress */}
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
              <div className="w-full h-1.5 rounded-full bg-base-200 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(siteGen.completed / siteGen.total) * 100}%` }} />
              </div>
              {siteGen.errors?.length > 0 && (
                <p className="text-xs text-error mt-1">{siteGen.errors.length} error{siteGen.errors.length === 1 ? '' : 's'} so far</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Email Extraction Progress */}
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

      {/* Column Picker */}
      {results.length > 0 && (
        <div className="relative">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setShowColPicker(!showColPicker)}
              className="btn btn-sm btn-ghost border border-base-300 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Columns ({visibleCols.length}/{ALL_COLUMNS.length})
              {showColPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <span className="text-sm text-base-content/40 font-mono">{results.length} results found (auto-saved)</span>
          </div>
          {showColPicker && (
            <div className="absolute z-50 top-10 left-0 bg-base-100 border border-base-300 rounded p-4 shadow-lg grid grid-cols-3 gap-2 min-w-[500px]">
              <div className="col-span-3 flex gap-2 mb-2 border-b border-base-300 pb-2">
                <button onClick={() => setVisibleCols(ALL_COLUMNS.map(c => c.key))} className="text-xs text-base-content hover:underline">Show All</button>
                <button onClick={() => setVisibleCols(DEFAULT_VISIBLE)} className="text-xs text-secondary hover:underline">Reset Default</button>
                <button onClick={() => setVisibleCols(['rank', 'title', 'score'])} className="text-xs text-base-content/40 hover:underline">Minimal</button>
              </div>
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
                  <th className="w-8">
                    <input type="checkbox" checked={selectedRows.size === sortedResults.length && sortedResults.length > 0}
                      onChange={toggleSelectAll} className="checkbox checkbox-xs" />
                  </th>
                  {ALL_COLUMNS.filter(c => visibleCols.includes(c.key)).map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)}
                      className="whitespace-nowrap text-[10px] font-medium uppercase tracking-wider cursor-pointer hover:text-base-content transition-colors" style={{ fontFamily: "'Inter',sans-serif", color: '#9CA3AF' }}>
                      <div className="flex items-center gap-1">
                        {col.label}
                        {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                      </div>
                    </th>
                  ))}
                  <th className="text-center text-[10px] font-medium uppercase tracking-wider" style={{ fontFamily: "'Inter',sans-serif", color: '#9CA3AF' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((place, idx) => {
                  const lead = apifyToLead(place, idx);
                  const isSaved = savedLeadIds.includes(lead.id);
                  const isSelected = selectedRows.has(idx);
                  return (
                    <tr key={place.placeId || idx}
                      className={`hover:bg-base-200/30 transition-colors border-b border-base-200 last:border-0 ${isSelected ? 'bg-base-200/40' : ''}`}>
                      <td className="px-3">
                        <input type="checkbox" checked={isSelected}
                          onChange={() => setSelectedRows(prev => {
                            const next = new Set(prev);
                            next.has(idx) ? next.delete(idx) : next.add(idx);
                            return next;
                          })}
                          className="checkbox checkbox-xs" />
                      </td>
                      {ALL_COLUMNS.filter(c => visibleCols.includes(c.key)).map(col => (
                        <td key={col.key} className="px-3 py-2.5">{renderCell(place, col.key, idx)}</td>
                      ))}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => {
                            const emails = emailMap[place.placeId || place.title] || [];
                            if (emails.length > 0) lead.email = emails[0];
                            onViewLead(lead);
                          }} className="btn btn-ghost btn-xs btn-square hover:bg-base-200" title="View Audit">
                            <Eye className="w-4 h-4" />
                          </button>
                          {isSaved ? (
                            <span className="p-1.5 text-success" title="Saved"><CheckCircle className="w-4 h-4" /></span>
                          ) : (
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
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && (
        <div className="text-center py-20 bg-base-100 rounded border border-base-300">
          <div className="w-14 h-14 bg-base-200 rounded flex items-center justify-center mx-auto mb-6">
            <Search className="w-7 h-7 text-base-content/30" />
          </div>
          <h3 className="text-xl font-bold text-base-content">Search for Local Business Leads</h3>
          <p className="text-base-content/40 mt-2 max-w-md mx-auto text-sm">Enter a business type and location above to find leads from Google Maps. Use the column picker to customize your view.</p>
          <div className="mt-8 flex flex-wrap gap-2 justify-center">
            {['Plumber', 'Dentist', 'Restaurant', 'Hair Salon', 'Lawyer', 'Real Estate'].map(ex => (
              <button key={ex} onClick={() => setKeyword(ex)}
                className="btn btn-sm btn-ghost border border-base-300 rounded px-4">{ex}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
