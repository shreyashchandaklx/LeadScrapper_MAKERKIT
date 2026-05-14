const categories = ['Plumber', 'Dentist', 'Restaurant', 'Lawyer', 'HVAC', 'Roofing', 'Auto Repair', 'Salon', 'Chiropractor', 'Real Estate'];
const cities = ['Austin, TX', 'Denver, CO', 'Miami, FL', 'Portland, OR', 'Nashville, TN', 'Phoenix, AZ', 'Atlanta, GA', 'Seattle, WA'];
const statuses = ['new', 'contacted', 'interested', 'closed', 'lost'];
const sentiments = ['positive', 'mixed', 'negative', 'none'];
const firstNames = ['Mike', 'Sarah', 'John', 'Lisa', 'David', 'Maria', 'James', 'Jennifer', 'Robert', 'Emily', 'Carlos', 'Amanda', 'Steve', 'Rachel', 'Tom'];
const lastNames = ['Johnson', 'Smith', 'Williams', 'Brown', 'Davis', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Garcia', 'Wilson', 'Lee', 'Clark', 'Hall'];

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }

function generateBusinessName(cat) {
  const prefixes = ['Superior', 'Elite', 'Pro', 'Express', 'Quality', 'Premier', 'All-Star', 'Apex', 'Pinnacle', 'Golden'];
  const suffixes = ['Solutions', 'Services', 'Group', 'Co', 'Plus', 'Hub', 'Center', 'Works', 'Pros', 'Masters'];
  return `${pick(prefixes)} ${cat} ${pick(suffixes)}`;
}

export function generateLeads(count = 25) {
  return Array.from({ length: count }, (_, i) => {
    const cat = pick(categories);
    const cityState = pick(cities);
    const [city, state] = cityState.split(', ');
    const name = generateBusinessName(cat);
    const gbp = Math.random() > 0.4;
    const hasWebsite = Math.random() > 0.3;
    const mobile = hasWebsite ? Math.random() > 0.4 : false;
    const ssl = hasWebsite ? Math.random() > 0.3 : false;
    const social = Math.random() > 0.5;
    const ads = Math.random() > 0.7;
    const rating = gbp ? +(Math.random() * 3 + 2).toFixed(1) : 0;
    const reviews = gbp ? rand(0, 200) : 0;
    const rank = gbp ? (Math.random() > 0.6 ? rand(1, 10) : null) : null;
    const sentiment = reviews === 0 ? 'none' : reviews < 10 ? 'mixed' : rating > 3.5 ? 'positive' : rating > 2.5 ? 'mixed' : 'negative';

    let score = 0;
    if (!gbp) score += 25;
    if (!hasWebsite) score += 20;
    if (!mobile) score += 15;
    if (!ssl) score += 10;
    if (!social) score += 10;
    if (reviews < 10) score += 10;
    if (rating < 3.5 && rating > 0) score += 5;
    if (!ads) score += 5;
    score = Math.min(score, 100);

    const ownerFirst = pick(firstNames);
    const ownerLast = pick(lastNames);

    return {
      id: `lead_${1000 + i}`,
      business_name: name,
      address: `${rand(100, 9999)} ${pick(['Main', 'Oak', 'Elm', 'Cedar', 'Pine', 'Maple', 'Broadway', 'Market'])} St`,
      city,
      state,
      phone: `(${rand(200, 999)}) ${rand(200, 999)}-${rand(1000, 9999)}`,
      email: Math.random() > 0.3 ? `info@${name.toLowerCase().replace(/[^a-z]/g, '')}.com` : '',
      website: hasWebsite ? `https://www.${name.toLowerCase().replace(/[^a-z]/g, '')}.com` : '',
      category: cat,
      rating,
      review_count: reviews,
      score,
      status: pick(statuses),
      notes: '',
      source: pick(['Google', 'Facebook', 'Yelp']),
      gbp_claimed: gbp,
      has_website: hasWebsite,
      mobile_responsive: mobile,
      has_ssl: ssl,
      has_social: social,
      running_ads: ads,
      three_pack_rank: rank,
      review_sentiment: sentiment,
      issues: [
        ...(!gbp ? ['GBP unclaimed'] : []),
        ...(!hasWebsite ? ['No website'] : []),
        ...(reviews < 10 ? ['Few reviews'] : []),
        ...(rating < 3.5 && rating > 0 ? ['Low rating'] : []),
        ...(!ssl && hasWebsite ? ['No SSL'] : []),
        ...(!social ? ['No social media'] : []),
      ],
      created_at: new Date(Date.now() - rand(0, 30) * 86400000).toISOString(),
      follow_up_date: Math.random() > 0.5 ? new Date(Date.now() + rand(1, 14) * 86400000).toISOString().split('T')[0] : null,
      owner_name: `${ownerFirst} ${ownerLast}`,
    };
  });
}

export const emailTemplates = [
  { id: 'et1', name: 'Missing GBP Claim', category: 'GBP', subject: 'Your Google Business Profile isn\'t claimed — you\'re losing customers', body: 'Hi {owner_name},\n\nI noticed that {business_name} doesn\'t have a claimed Google Business Profile. This means potential customers in {city} can\'t easily find your hours, reviews, or contact info.\n\nBusinesses that claim and optimize their GBP see up to 70% more visits. I\'d love to help you set this up — it\'s quick and the ROI is huge.\n\nWould you be open to a 10-minute call this week?\n\nBest,\n[Your Name]' },
  { id: 'et2', name: 'Low Reviews Outreach', category: 'Reviews', subject: 'Quick way to get more 5-star reviews for {business_name}', body: 'Hi {owner_name},\n\nI came across {business_name} and noticed you only have {review_count} reviews on Google. In today\'s market, reviews are the #1 factor customers look at before choosing a {category}.\n\nI help businesses like yours generate 20-50 new reviews per month using a simple automated system.\n\nWant me to show you how it works?\n\nBest,\n[Your Name]' },
  { id: 'et3', name: 'No Website Pitch', category: 'Website', subject: '{business_name} is invisible online — let\'s fix that', body: 'Hi {owner_name},\n\nI searched for {category} services in {city} and couldn\'t find a website for {business_name}. Without a website, you\'re missing out on 80% of local customers who search online first.\n\nI build fast, mobile-friendly websites for local businesses — starting at just $499.\n\nCan I send you some examples of what I\'ve done for other {category} businesses?\n\nBest,\n[Your Name]' },
  { id: 'et4', name: 'SEO Opportunity', category: 'SEO', subject: '{business_name} isn\'t showing up on Google — here\'s why', body: 'Hi {owner_name},\n\nI was researching {category} businesses in {city} and noticed {business_name} isn\'t appearing in Google\'s top results. Your competitors are getting the clicks — and the customers — that should be yours.\n\nI specialize in local SEO and can help you rank in the Google 3-Pack within 90 days.\n\nWould you like a free SEO audit of your business?\n\nBest,\n[Your Name]' },
  { id: 'et5', name: 'General Introduction', category: 'General', subject: 'Helping {business_name} get more customers from Google', body: 'Hi {owner_name},\n\nI\'m reaching out because I found a few areas where {business_name} could improve its online presence and attract more customers.\n\nHere\'s what I noticed:\n{issue_found}\n\nI help local businesses like yours fix these issues and grow. Would you be open to a quick chat?\n\nBest,\n[Your Name]' },
];

export function generateEmails(leads) {
  const contactedLeads = leads.filter(l => l.status !== 'new').slice(0, 8);
  return contactedLeads.map((l, i) => ({
    id: `em_${2000 + i}`,
    lead_id: l.id,
    lead_name: l.business_name,
    from_email: 'you@youragency.com',
    to_email: l.email || `info@${l.business_name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
    subject: `Helping ${l.business_name} get more customers`,
    body: 'Email body...',
    sent_at: new Date(Date.now() - rand(0, 14) * 86400000).toISOString(),
    status: pick(['sent', 'opened', 'replied', 'bounced']),
  }));
}

export function generateReports(leads) {
  return leads.slice(0, 6).map((l, i) => ({
    id: `rpt_${3000 + i}`,
    lead_id: l.id,
    lead_name: l.business_name,
    created_at: new Date(Date.now() - rand(0, 7) * 86400000).toISOString(),
    score: l.score,
  }));
}

export const subscriptionPlans = [
  { name: 'Starter', price: '$57', billing: '/month', leads_per_month: 5000, reports_per_month: 50, features: ['Core AI Features', 'Google & Facebook Search', 'Lead Scoring', 'Basic Reports', 'Email Templates'] },
  { name: 'Pro', price: '$77', billing: '/month', leads_per_month: 10000, reports_per_month: 200, features: ['Everything in Starter', 'Advanced AI Audit', 'PDF Report Generator', 'Cold Email AI', 'Review Responder', 'Priority Support'], popular: true },
  { name: 'Agency', price: '$97', billing: '/month', leads_per_month: 25000, reports_per_month: 500, features: ['Everything in Pro', 'Citation Tools', 'White-Label Reports', 'Client CRM', 'Team Access', 'API Access', 'Commercial License'] },
];
