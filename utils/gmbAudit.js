export function runFullAudit(data) {
  if (!data) return null;

  const result = {
    profile: analyzeProfile(data),
    sentiment: analyzeSentiment(data.reviews || []),
    velocity: calculateReviewVelocity(data.reviews || []),
    keywords: extractKeywordThemes(data.reviews || []),
    photoAudit: auditPhotos(data.photos || []),
    recommendations: [],
    ratingDistribution: calculateRatingDistribution(data.reviews || []),
  };

  result.score = calculateOverallScore(data, result);
  result.recommendations = generateRecommendations(data, result);

  return result;
}

function analyzeProfile(data) {
  const checklist = [
    { id: 'name', label: 'Business Name', present: !!data.name },
    { id: 'address', label: 'Address', present: !!data.address },
    { id: 'phone', label: 'Phone Number', present: !!data.phone },
    { id: 'website', label: 'Website', present: !!data.website },
    { id: 'category', label: 'Category', present: !!data.category },
    { id: 'hours', label: 'Business Hours', present: data.hours && data.hours.length > 0 },
    { id: 'photos', label: 'Photos', present: data.photos && data.photos.length > 0 }
  ];

  const presentCount = checklist.filter(item => item.present).length;
  const score = Math.round((presentCount / checklist.length) * 100);

  return { checklist, score };
}

function analyzeSentiment(reviews) {
  let positive = 0, neutral = 0, negative = 0;
  
  // Basic keywords for sentiment (expandable)
  const posWords = ['great', 'excellent', 'good', 'best', 'amazing', 'love', 'perfect', 'friendly', 'helpful', 'recommend', 'professional', 'awesome', 'fantastic', 'nice', 'clean'];
  const negWords = ['bad', 'terrible', 'awful', 'worst', 'poor', 'rude', 'unprofessional', 'dirty', 'expensive', 'slow', 'avoid', 'disappointing', 'never'];

  reviews.forEach(review => {
    if (review.rating >= 4) {
      positive++;
    } else if (review.rating === 3) {
      neutral++;
    } else if (review.rating > 0) {
      negative++;
    } else if (review.text) {
      const text = review.text.toLowerCase();
      let posScore = posWords.filter(w => text.includes(w)).length;
      let negScore = negWords.filter(w => text.includes(w)).length;
      
      if (posScore > negScore) positive++;
      else if (negScore > posScore) negative++;
      else neutral++;
    } else {
      neutral++;
    }
  });

  const total = positive + neutral + negative;
  
  return {
    total,
    positiveCount: positive,
    neutralCount: neutral,
    negativeCount: negative,
    positive: total > 0 ? Math.round((positive / total) * 100) : 0,
    neutral: total > 0 ? Math.round((neutral / total) * 100) : 0,
    negative: total > 0 ? Math.round((negative / total) * 100) : 0
  };
}

function calculateReviewVelocity(reviews) {
  if (!reviews || reviews.length === 0) return { perMonth: 0, trend: 'N/A' };
  
  // Assuming time field contains "x months ago", "y years ago" etc for a rough estimate
  // This is a simplified version. Ideally we'd have exact dates.
  let recentCount = 0;
  reviews.forEach(review => {
    const time = (review.time || '').toLowerCase();
    if (time.includes('day') || time.includes('week') || time.includes('month')) {
      recentCount++;
    }
  });

  const perMonth = Math.round((recentCount / Math.max(1, reviews.length)) * 10) / 10;
  let trend = 'Stable';
  if (perMonth > 2) trend = 'Growing';
  if (perMonth === 0) trend = 'Declining';

  return { perMonth, trend };
}

function extractKeywordThemes(reviews) {
  if (!reviews || reviews.length === 0) return [];
  
  const words = {};
  const stopWords = ['the', 'and', 'a', 'to', 'of', 'in', 'i', 'is', 'that', 'it', 'for', 'you', 'was', 'with', 'on', 'as', 'have', 'but', 'we', 'they', 'at', 'this', 'my', 'are', 'not', 'be', 'so', 'very', 'had', 'just', 'there', 'out', 'up', 'all', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'one', 'from', 'would', 'like', 'time', 'were', 'our', 'what', 'their', 'can', 'has', 'an', 'do', 'will', 'been', 'he', 'good', 'great', 'place', 'service', 'really', 'back', 'here', 'also', 'some', 'more', 'only'];

  reviews.forEach(review => {
    if (!review.text) return;
    const textWords = review.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    textWords.forEach(word => {
      if (word.length > 3 && !stopWords.includes(word)) {
        words[word] = (words[word] || 0) + 1;
      }
    });
  });

  const sorted = Object.keys(words).map(k => ({ text: k, count: words[k] })).sort((a, b) => b.count - a.count);
  return sorted.slice(0, 5);
}

function auditPhotos(photos) {
  const count = photos ? photos.length : 0;
  let score = 0;
  let level = 'poor';

  if (count >= 10) { score = 100; level = 'excellent'; }
  else if (count >= 5) { score = 70; level = 'good'; }
  else if (count >= 1) { score = 40; level = 'fair'; }

  return {
    count,
    score,
    level,
    benchmarks: { min: 1, good: 5, excellent: 10 }
  };
}

function calculateRatingDistribution(reviews) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  
  reviews.forEach(review => {
    if (review.rating && review.rating >= 1 && review.rating <= 5) {
      dist[Math.round(review.rating)]++;
      count++;
    }
  });

  return { distribution: dist, sampleSize: count };
}

function calculateOverallScore(data, result) {
  const weights = {
    profile: 0.3,
    rating: 0.3,
    reviews: 0.2,
    photos: 0.1,
    sentiment: 0.1
  };

  const ratingScore = data.rating ? Math.min(100, Math.round((data.rating / 5) * 100)) : 0;
  const reviewScore = Math.min(100, (data.reviewCount || 0)); // Cap at 100 reviews for score
  const sentimentScore = result.sentiment.positive;

  const components = {
    profile: result.profile.score,
    rating: ratingScore,
    reviews: reviewScore,
    photos: result.photoAudit.score,
    sentiment: sentimentScore
  };

  const overall = Math.round(
    (components.profile * weights.profile) +
    (components.rating * weights.rating) +
    (components.reviews * weights.reviews) +
    (components.photos * weights.photos) +
    (components.sentiment * weights.sentiment)
  );

  return { overall, components };
}

function generateRecommendations(data, result) {
  const recs = [];

  if (result.profile.score < 100) {
    const missing = result.profile.checklist.filter(i => !i.present).map(i => i.label);
    recs.push({
      severity: 'critical',
      text: `Complete your profile by adding missing information: ${missing.join(', ')}.`
    });
  }

  if ((data.rating || 0) < 4.0) {
    recs.push({
      severity: 'warning',
      text: 'Your average rating is below 4.0. Focus on improving customer experience and addressing negative feedback.'
    });
  }

  if ((data.reviewCount || 0) < 20) {
    recs.push({
      severity: 'warning',
      text: 'You have very few reviews. Implement a strategy to actively ask satisfied customers for reviews.'
    });
  }

  if (result.sentiment.negative > 20) {
    recs.push({
      severity: 'critical',
      text: `High negative sentiment detected (${result.sentiment.negative}%). Identify common complaints and resolve operational issues.`
    });
  }

  if (result.photoAudit.count < result.photoAudit.benchmarks.good) {
    recs.push({
      severity: 'warning',
      text: 'Add more high-quality photos. Listings with photos receive more requests for directions and website clicks.'
    });
  }

  if (recs.length === 0) {
    recs.push({
      severity: 'good',
      text: 'Your Google Business Profile is well-optimized. Continue maintaining current practices and responding to new reviews promptly.'
    });
  }

  return recs;
}
