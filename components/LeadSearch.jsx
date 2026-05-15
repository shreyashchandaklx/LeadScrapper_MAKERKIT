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

export default function LeadSearch({ onViewLead, onSaveLead, onBulkSaveLeads, savedLeadIds, leads = [], onGenerateSites, siteGen, onCancelSiteGen }) {
  const [keyword, setKeyword] = useState('');
  const [country, setCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
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

  /* Row selection state */
  const [selectedRows, setSelectedRows] = useState(new Set()); // Stores indices of selected rows

  /* Email extraction state */
  const [emailMap, setEmailMap] = useState({}); // Stores emails found per placeId/title
  const [emailExtracting, setEmailExtracting] = useState(false);
  const [emailProgress, setEmailProgress] = useState({ completed: 0, total: 0, found: 0 });
  const emailCancelRef = useRef(false); // Ref to signal email extraction cancellation

  /* Credit system state */
  const userEmail = (typeof window !== 'undefined' && localStorage.getItem('loggedInUser')) || '';
  const [balance, setBalance] = useState(null);          // null = unknown, number = credits
  const [chargeInfo, setChargeInfo] = useState(null);    // Info about credits charged for the last search

  /* Timer refs */
  const timerRef = useRef(null);
  const cancelRef = useRef(false); // Ref to signal search cancellation
  const cacheModeRef = useRef(false); // Tracks if current search is using cached data

  // Derive location string from cascading selections for display/search
  const location = useMemo(() => {
    const parts = [];
    if (selectedCity) parts.push(selectedCity);
    if (selectedState) parts.push(selectedState);
    if (country) parts.push(country);
    return parts.join(', ');
  }, [country, selectedState, selectedCity]);

  // Memoize states and cities lists based on selected country for performance
  const statesList = useMemo(() => {
    const countryObj = COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase().trim() || c.code.toLowerCase() === country.toLowerCase().trim());
    return countryObj ? getStates(countryObj.code) : [];
  }, [country]);

  const citiesList = useMemo(() => {
    const countryObj = COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase().trim() || c.code.toLowerCase() === country.toLowerCase().trim());
    return countryObj && selectedState ? getCities(countryObj.code, selectedState) : [];
  }, [country, selectedState]);

  /* Function to refresh the user's credit balance */
  const refreshBalance = useCallback(async () => {
    if (!userEmail) return; // Don't fetch if no user is logged in
    try {
      const response = await fetch(`${APIFY_PROXY_URL}?action=balance&email=${encodeURIComponent(userEmail)}`);
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.balance === 'number') setBalance(data.balance);
    } catch (error) {
      console.error("Failed to refresh balance:", error);
      // Ignore errors, balance will remain null or previous value
    }
  }, [userEmail]);

  // Fetch balance on initial mount and when userEmail changes
  useEffect(() => { refreshBalance(); }, [refreshBalance]);

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

  /* Handle the main search operation */
  const handleSearch = async () => {
    if (!keyword.trim() || !country.trim() || !selectedState.trim() || !zipCode.trim()) {
      alert('Please fill in all required fields: Keyword, Country, State, and ZIP code.');
      return;
    }
    if (!userEmail) {
      alert('You must be logged in. Please log in with your email to search for leads.');
      return;
    }

    // Reset state for new search
    setLoading(true);
    setResults([]);
    setChargeInfo(null);
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
        const countryObj = COUNTRIES.find(c => c.name.toLowerCase() === country.toLowerCase().trim() || c.code.toLowerCase() === country.toLowerCase().trim());
        if (countryObj) {
          requestBody.countryCode = countryObj.code.toLowerCase();
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
        setBalance(typeof errorData.balance === 'number' ? errorData.balance : 0); // Update balance shown
        throw new Error(`Insufficient credits (balance ${errorData.balance ?? 0}). Top up at app.pixnom.com to continue.`);
      }
      if (!runResponse.ok) { // Other API errors
        const errorData = await runResponse.json();
        throw new Error(errorData?.error?.message || errorData?.error || `Failed to start Apify run (${runResponse.status})`);
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

      // Ensure results are an array
      let places = Array.isArray(apifyResults) ? apifyResults : (apifyResults.items || apifyResults.data || []);
      if (!Array.isArray(places)) {
        throw new Error('Apify Dataset API returned an invalid non-array format.');
      }

      // Add rank to each place if missing (used for sorting/display)
      places.forEach((p, i) => { if (!p.rank) p.rank = i + 1; });

      // Calculate estimated charge and update charge info state
      const deliveredCount = places.length;
      const estimatedCharge = Number((deliveredCount * 0.01).toFixed(2)); // 0.01 credit per lead
      setChargeInfo({
        delivered: deliveredCount,
        charged: estimatedCharge,
        cached, // Indicate if data came from cache
      });
      refreshBalance(); // Fetch authoritative balance after potential deduction

      setResults(places); // Update results state
      setProgress(cached
        ? `Found ${places.length} businesses (served from cache) — Charged ${estimatedCharge.toFixed(2)} credits.`
        : `Found ${places.length} businesses — Charged ${estimatedCharge.toFixed(2)} credits.`);

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

    } catch (error) {
      console.error('Search operation failed:', error);
      setProgress(`Error: ${error.message}`);
      alert(`Search failed: ${error.message}`); // Alert user to the error
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
  };

  /* Toggle selection for all rows */
  const toggleSelectAll = () => {
    if (selectedRows.size === sortedResults.length && sortedResults.length > 0) {
      setSelectedRows(new Set()); // Deselect all if all are currently selected
    } else {
      // Select all rows
      setSelectedRows(new Set(sortedResults.map((_, index) => index)));
    }
  };

  /* Save selected leads via bulk API call */
  const saveSelectedLeads = () => {
    const leadsToSave = [];
    selectedRows.forEach(index => { // Iterate through selected indices
      const place = sortedResults[index];
      const lead = apifyToLead(place, index);
      const emails = emailMap[place.placeId || place.title] || [];
      if (emails.length > 0) lead.email = emails[0]; // Assign first extracted email
      if (!savedLeadIds.includes(lead.id)) leadsToSave.push(lead); // Add only if not already saved
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

      {/* Search Controls Section */}
      <div className="bg-base-100 rounded p-5 border border-base-300">
        {/* Row 1: Keyword, Country, State */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Keyword Input */}
          <div>
            <label className="block text-sm text-base-content/60 mb-1">Business Type / Keyword</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input type="text" placeholder="e.g. Plumber, Dentist, Restaurant..." value={keyword} onChange={e => setKeyword(e.target.value)}
                className="input input-bordered w-full pl-10 h-10 text-sm"
                onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
            </div>
          </div>
          {/* Country Input */}
          <div>
            <label className="block text-sm text-base-content/60 mb-1">Country</label>
            <div className="relative">
              <Flag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input type="text" placeholder="e.g. India, United States..." value={country} onChange={e => {
                setCountry(e.target.value);
                // Reset state selections when country changes
                setSelectedState('');
                setSelectedCity('');
              }}
                className="input input-bordered w-full pl-10 h-10 text-sm"
                onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
            </div>
          </div>
          {/* State Dropdown (if dynamic list available) or Input */}
          {statesList.length > 0 ? (
            <SearchableDropdown
              label="State / Province"
              icon={MapPinned}
              placeholder="Select state..."
              options={statesList}
              value={selectedState}
              onChange={(val) => {
                setSelectedState(val);
                setSelectedCity(''); // Reset city when state changes
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

        {/* Row 2: City, ZIP Code, Search Button & Credits Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {/* City Dropdown or Input */}
          {statesList.length > 0 ? (
            <SearchableDropdown
              label="City"
              icon={MapPin}
              placeholder={selectedState ? 'Select city...' : 'Select state first'}
              options={citiesList}
              value={selectedCity}
              onChange={setSelectedCity}
              disabled={!selectedState} // Disable if no state selected
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
          {/* ZIP Code Input */}
          <div>
            <label className="block text-sm text-base-content/60 mb-1">ZIP / Postal Code</label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
              <input type="text" placeholder="e.g. 10001, 400001..." value={zipCode} onChange={e => setZipCode(e.target.value)}
                className="input input-bordered w-full pl-10 h-10 text-sm"
                onKeyDown={e => e.key === 'Enter' && !loading && handleSearch()} />
            </div>
          </div>
          {/* Search Button and Credits Display */}
          <div className="flex items-end flex-col gap-1">
            {/* Credits display */}
            <div className="self-end flex items-center gap-2 text-xs text-base-content/70 mb-0.5" title="1 credit = 100 leads (0.01 credit per lead)">
              <Zap className="w-3.5 h-3.5 text-yellow-500" />
              {balance === null
                ? 'Loading credits…'
                : `Balance: ${Number(balance).toFixed(2)} credits ≈ ${Math.floor(balance * 100)} leads`}
            </div>
            {/* Search Button */}
            <button onClick={handleSearch} disabled={loading || !keyword.trim() || !country.trim() || !selectedState.trim() || !zipCode.trim()}
              className="btn btn-primary w-full h-10 min-h-0 font-medium flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Searching...</> : <><Search className="w-4 h-4" /> Search Leads</>}
            </button>
          </div>
        </div>

        {/* Charging Information Display */}
        {chargeInfo && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span className="text-base-content/70">
              Charged <b>{chargeInfo.charged.toFixed(2)}</b> credit{chargeInfo.charged === 1 ? '' : 's'} for <b>{chargeInfo.delivered}</b> lead{chargeInfo.delivered === 1 ? '' : 's'}
              {chargeInfo.cached ? ' (served from cache)' : ''}
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
              <span className="text-xs font-medium text-base-content bg-base-200 px-2.5 py-1 rounded">ZIP: {zipCode.trim()}{country ? `, ${country}` : ''}</span>
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
              <button onClick={() => cancelRef.current = true} className="btn btn-xs btn-error btn-outline">Cancel</button>
            </div>
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
            <span className="text-sm text-base-content/40 font-mono">{results.length} results found (auto-saved)</span>
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
                {/* Render table rows for sorted results */}
                {sortedResults.map((place, index) => {
                  // Convert Apify place data to lead object, get emails, check if saved
                  const lead = apifyToLead(place, index);
                  const isSaved = savedLeadIds.includes(lead.id);
                  const isSelected = selectedRows.has(index);
                  return (
                    <tr key={place.placeId || index}
                      className={`hover:bg-base-200/30 transition-colors border-b border-base-200 last:border-0 ${isSelected ? 'bg-base-200/40' : ''}`}>
                      {/* Row selection checkbox */}
                      <td className="px-3">
                        <input type="checkbox" checked={isSelected}
                          onChange={() => setSelectedRows(prev => { // Toggle selection state
                            const next = new Set(prev);
                            next.has(index) ? next.delete(index) : next.add(index);
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
