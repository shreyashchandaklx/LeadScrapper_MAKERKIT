export function getScoreColor(score) {
  if (score >= 7.5) return 'text-error';
  if (score >= 5.0) return 'text-warning';
  if (score >= 2.5) return 'text-base-content/70';
  return 'text-success';
}

export function getScoreBg(score) {
  if (score >= 7.5) return 'bg-error/10';
  if (score >= 5.0) return 'bg-warning/10';
  if (score >= 2.5) return 'bg-base-200';
  return 'bg-success/10';
}

export function getScoreLabel(score) {
  if (score >= 7.5) return 'Hot Lead';
  if (score >= 5.0) return 'Warm Lead';
  if (score >= 2.5) return 'Cool Lead';
  return 'Low Priority';
}

export function getStatusBadge(status) {
  switch (status) {
    case 'new': return 'badge-neutral';
    case 'contacted': return 'badge-warning';
    case 'interested': return 'badge-secondary';
    case 'closed': return 'badge-success';
    case 'lost': return 'badge-error';
    default: return 'badge-ghost';
  }
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function auditLead(lead) {
  const issues = [];
  const recommendations = [];

  if (!lead.gbp_claimed) {
    issues.push('Google Business Profile is not claimed');
    recommendations.push('Claim and optimize your Google Business Profile to appear in local search results');
  }
  if (!lead.has_website) {
    issues.push('No website found');
    recommendations.push('Build a mobile-responsive website to capture online traffic');
  }
  if (!lead.mobile_responsive) {
    issues.push('Website is not mobile-responsive');
    recommendations.push('Optimize website for mobile devices — 60%+ of local searches are on mobile');
  }
  if (!lead.has_ssl) {
    issues.push('No SSL certificate detected');
    recommendations.push('Install an SSL certificate to secure your website and boost SEO rankings');
  }
  if (!lead.has_social) {
    issues.push('No social media presence found');
    recommendations.push('Create and maintain Facebook and Instagram profiles to engage local customers');
  }
  if (lead.review_count < 10) {
    issues.push(`Only ${lead.review_count} reviews (below industry average)`);
    recommendations.push('Implement a review generation strategy to build social proof');
  }
  if (lead.rating > 0 && lead.rating < 3.5) {
    issues.push(`Low rating: ${lead.rating}/5.0`);
    recommendations.push('Address negative reviews and improve customer experience to boost ratings');
  }
  if (!lead.running_ads) {
    issues.push('Not running Google Ads');
    recommendations.push('Consider Google Ads to capture high-intent local searches');
  }
  if (!lead.three_pack_rank) {
    issues.push('Not ranking in Google 3-Pack');
    recommendations.push('Optimize local SEO to rank in Google Maps 3-Pack for key terms');
  }

  return {
    gbp_claimed: lead.gbp_claimed,
    mobile_responsive: lead.mobile_responsive,
    has_ssl: lead.has_ssl,
    has_social: lead.has_social,
    running_ads: lead.running_ads,
    three_pack_rank: lead.three_pack_rank,
    review_count: lead.review_count,
    review_sentiment: lead.review_sentiment,
    rating: lead.rating,
    issues,
    recommendations,
  };
}

export function fillTemplate(template, lead) {
  return template
    .replace(/\{business_name\}/g, lead.business_name)
    .replace(/\{owner_name\}/g, lead.owner_name)
    .replace(/\{city\}/g, lead.city)
    .replace(/\{category\}/g, lead.category)
    .replace(/\{review_count\}/g, String(lead.review_count))
    .replace(/\{rating\}/g, String(lead.rating))
    .replace(/\{issue_found\}/g, auditLead(lead).issues.map(i => `• ${i}`).join('\n'));
}
