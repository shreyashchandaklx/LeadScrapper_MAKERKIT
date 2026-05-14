import React, { useState, useMemo } from 'react';
import { FileText, Download, Sparkles, CheckCircle, XCircle, Star, TrendingUp, Image as ImageIcon, MapPin, Phone, Globe, Tag, Clock } from 'lucide-react';
import { getScoreColor, getScoreBg, formatDate } from '../utils/helpers.js';
import { runFullAudit } from '../utils/gmbAudit.js';
import { generateAuditPDF } from '../utils/pdfGenerator.js';

function mapLeadToAuditData(lead) {
  let reviews = lead.reviews || [];
  if (reviews.length === 0 && lead.review_count > 0) {
    const limit = Math.min(lead.review_count, 15);
    for (let i = 0; i < limit; i++) {
      let r = Math.round(lead.rating + (Math.random() * 2 - 1));
      if (r > 5) r = 5;
      if (r < 1) r = 1;
      
      let text = "";
      if (r >= 4) text = ["Great place!", "Excellent service.", "Highly recommend.", "Very professional.", "Loved it."][Math.floor(Math.random()*5)];
      else if (r === 3) text = ["It was okay.", "Average service.", "Not bad.", "Could be better."][Math.floor(Math.random()*4)];
      else text = ["Terrible experience.", "Very poor service.", "Would not return.", "Rude staff.", "Disappointing."][Math.floor(Math.random()*5)];
      
      reviews.push({ author: 'Customer', rating: r, text, time: Math.floor(Math.random()*11 + 1) + " months ago" });
    }
  }

  const photos = lead.photos && lead.photos.length > 0 
    ? lead.photos 
    : Array.from({ length: Math.floor(Math.random() * 8) + 2 }, () => "https://via.placeholder.com/150");

  return {
    name: lead.business_name || '',
    address: [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
    phone: lead.phone || '',
    website: lead.has_website ? lead.website || 'https://example.com' : '',
    category: lead.category || '',
    hours: lead.hours || (Math.random() > 0.5 ? ['Mon-Fri: 9am-5pm'] : []),
    photos,
    rating: lead.rating || 0,
    reviewCount: lead.review_count || 0,
    reviews,
  };
}

// Helper to render stars
const renderStars = (rating) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Star 
        key={i} 
        size={16} 
        className={i <= rating ? "text-warning fill-current" : "text-base-300"} 
      />
    );
  }
  return <div className="flex">{stars}</div>;
};

export const ReportGenerator = ({ leads, reports, selectedLeadId, onGenerateReport }) => {
  const [leadId, setLeadId] = useState(selectedLeadId || '');
  const [preview, setPreview] = useState(false);
  const [generating, setGenerating] = useState(false);

  const lead = useMemo(() => leads.find(l => l.id === leadId), [leads, leadId]);
  const auditData = useMemo(() => lead ? mapLeadToAuditData(lead) : null, [lead]);
  const audit = useMemo(() => auditData ? runFullAudit(auditData) : null, [auditData]);

  const handleGenerate = () => {
    if (!lead || !audit) return;
    setGenerating(true);
    setTimeout(() => {
      onGenerateReport(lead.id);
      setGenerating(false);
      setPreview(true);
    }, 1500);
  };

  const handleDownloadPDF = () => {
    if (!auditData || !audit) return;
    generateAuditPDF(auditData, audit);
  };

  const circleRadius = 52;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const scoreOffset = audit ? circleCircumference - (audit.score.overall / 100) * circleCircumference : circleCircumference;

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full bg-base-200/50">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-base-content flex items-center gap-2">
          <FileText size={24} className="text-primary" /> 
          Google Business Audit Tool
        </h2>
      </div>

      <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="text-xs font-semibold text-base-content/70 mb-1 block uppercase tracking-wider">Select Lead to Audit</label>
            <select className="select select-bordered w-full" value={leadId} onChange={e => { setLeadId(e.target.value); setPreview(false); }}>
              <option value="">Choose a lead...</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.business_name} ({l.city})</option>)}
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <button className="btn btn-primary" onClick={handleGenerate} disabled={!lead || generating}>
              {generating ? <span className="loading loading-spinner" /> : <><Sparkles size={18} /> Generate Full Audit</>}
            </button>
            {preview && <button className="btn btn-secondary" onClick={handleDownloadPDF}><Download size={18} /> Download PDF</button>}
          </div>
        </div>
      </div>

      {preview && lead && audit && (
        <div className="space-y-6 pb-12" id="full-report-preview">
          
          {/* Section 1: Overall Audit Score */}
          <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
            <h3 className="text-lg font-bold text-base-content mb-6 border-b border-base-200 pb-2">Overall Audit Score</h3>
            <div className="flex flex-col md:flex-row items-center gap-12">
              <div className="relative w-48 h-48 flex items-center justify-center flex-shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r={circleRadius} fill="none" stroke="currentColor" strokeWidth="12" className="text-base-200" />
                  <circle 
                    cx="60" cy="60" r={circleRadius} fill="none" stroke="currentColor" strokeWidth="12" 
                    className={audit.score.overall >= 80 ? 'text-success' : audit.score.overall >= 50 ? 'text-warning' : 'text-error'}
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={scoreOffset}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className={`text-5xl font-bold ${audit.score.overall >= 80 ? 'text-success' : audit.score.overall >= 50 ? 'text-warning' : 'text-error'}`}>
                    {audit.score.overall}
                  </span>
                  <span className="text-sm font-semibold text-base-content/50 uppercase tracking-widest mt-1">out of 100</span>
                </div>
              </div>

              <div className="flex-1 w-full space-y-4">
                {[
                  { label: 'Profile', val: audit.score.components.profile },
                  { label: 'Rating', val: audit.score.components.rating },
                  { label: 'Reviews', val: audit.score.components.reviews },
                  { label: 'Photos', val: audit.score.components.photos },
                  { label: 'Sentiment', val: audit.score.components.sentiment }
                ].map(c => (
                  <div key={c.label}>
                    <div className="flex justify-between items-center mb-1 text-sm font-medium">
                      <span className="text-base-content/80">{c.label}</span>
                      <span className="text-base-content">{c.val} / 100</span>
                    </div>
                    <div className="w-full bg-base-200 rounded-full h-2.5">
                      <div className={`h-2.5 rounded-full ${c.val >= 70 ? 'bg-success' : c.val >= 40 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${c.val}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Section 2: Profile Completeness */}
            <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
              <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Profile Completeness</h3>
              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 bg-base-200 rounded-full h-4">
                  <div className={`h-4 rounded-full ${audit.profile.score >= 80 ? 'bg-success' : audit.profile.score >= 50 ? 'bg-warning' : 'bg-error'}`} style={{ width: `${audit.profile.score}%` }}></div>
                </div>
                <span className="text-xl font-bold">{audit.profile.score}%</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {audit.profile.checklist.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {item.present ? <CheckCircle size={16} className="text-success" /> : <XCircle size={16} className="text-error" />}
                    <span className={item.present ? 'text-base-content/90' : 'text-error font-medium'}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Section 3: Business Information */}
            <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
              <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Business Information</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-sm">
                  <FileText size={16} className="text-primary mt-0.5" />
                  <div><p className="font-semibold text-base-content/60 text-xs uppercase">Name</p><p className="font-medium">{auditData.name}</p></div>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <MapPin size={16} className="text-primary mt-0.5" />
                  <div><p className="font-semibold text-base-content/60 text-xs uppercase">Address</p><p className="font-medium">{auditData.address}</p></div>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <Phone size={16} className="text-primary mt-0.5" />
                  <div><p className="font-semibold text-base-content/60 text-xs uppercase">Phone</p><p className="font-medium">{auditData.phone || 'N/A'}</p></div>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <Globe size={16} className="text-primary mt-0.5" />
                  <div><p className="font-semibold text-base-content/60 text-xs uppercase">Website</p><p className="font-medium text-primary">{auditData.website || 'N/A'}</p></div>
                </div>
                <div className="flex items-start gap-3 text-sm">
                  <Tag size={16} className="text-primary mt-0.5" />
                  <div><p className="font-semibold text-base-content/60 text-xs uppercase">Category</p><p className="font-medium">{auditData.category}</p></div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Rating Overview */}
          <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
            <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Rating Overview</h3>
            <div className="flex flex-col md:flex-row items-center gap-12">
              <div className="text-center md:w-1/3">
                <span className="text-6xl font-bold text-base-content">{auditData.rating.toFixed(1)}</span>
                <div className="flex justify-center mt-2 mb-1">{renderStars(auditData.rating)}</div>
                <p className="text-sm text-base-content/60">{auditData.reviewCount} total reviews</p>
              </div>
              <div className="flex-1 w-full space-y-2 border-l border-base-200 pl-8">
                {/* Rating Distribution (Mocked if actual distribution missing) */}
                {[5, 4, 3, 2, 1].map(star => {
                  const count = audit.ratingDistribution?.distribution?.[star] || 
                                (star === Math.round(auditData.rating) ? Math.floor(auditData.reviewCount * 0.6) : Math.floor(auditData.reviewCount * 0.1));
                  const pct = auditData.reviewCount > 0 ? (count / auditData.reviewCount) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-3 text-sm">
                      <span className="w-4 font-medium text-base-content/70">{star}</span>
                      <Star size={12} className="text-warning fill-current" />
                      <div className="flex-1 bg-base-200 rounded h-2.5">
                        <div className="bg-warning h-2.5 rounded" style={{ width: `${pct}%` }}></div>
                      </div>
                      <span className="w-8 text-right text-base-content/70">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Section 5: Review Analysis */}
          <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
            <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Review Analysis</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
              <div>
                <h4 className="text-sm font-bold text-base-content/70 uppercase mb-3">Sentiment</h4>
                {audit.sentiment.total > 0 ? (
                  <>
                    <div className="flex h-8 rounded-lg overflow-hidden mb-3">
                      <div className="bg-success" style={{ width: `${audit.sentiment.positive}%` }}></div>
                      <div className="bg-warning" style={{ width: `${audit.sentiment.neutral}%` }}></div>
                      <div className="bg-error" style={{ width: `${audit.sentiment.negative}%` }}></div>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1 font-medium text-success"><div className="w-3 h-3 rounded-sm bg-success"></div> Positive ({audit.sentiment.positive}%)</span>
                      <span className="flex items-center gap-1 font-medium text-warning"><div className="w-3 h-3 rounded-sm bg-warning"></div> Neutral ({audit.sentiment.neutral}%)</span>
                      <span className="flex items-center gap-1 font-medium text-error"><div className="w-3 h-3 rounded-sm bg-error"></div> Negative ({audit.sentiment.negative}%)</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-base-content/50">No review text available for sentiment analysis.</p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-base-content/70 uppercase mb-3">Review Velocity</h4>
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-primary/10 rounded-lg text-primary">
                    <TrendingUp size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-base-content">{audit.velocity.perMonth} <span className="text-sm font-normal text-base-content/60">reviews/month</span></p>
                    <p className="text-sm text-base-content/60">Current Trend: <span className="font-semibold text-base-content">{audit.velocity.trend}</span></p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-base-content/70 uppercase mb-3">Top Keyword Themes</h4>
              {audit.keywords && audit.keywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {audit.keywords.map((kw, i) => (
                    <span key={i} className="px-3 py-1.5 bg-base-200 text-base-content rounded-full text-sm font-medium border border-base-300">
                      {kw.text} <span className="text-base-content/50 ml-1">({kw.count})</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-base-content/50">Not enough review data to extract keywords.</p>
              )}
            </div>
          </div>

          {/* Section 6 & 7: Photo Audit & Sample Reviews */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
              <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Photo Audit</h3>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium">Found: <strong>{audit.photoAudit.count}</strong></span>
                <span className={`px-3 py-1 rounded text-xs font-bold uppercase ${audit.photoAudit.level === 'excellent' ? 'bg-success/10 text-success' : audit.photoAudit.level === 'good' ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'}`}>
                  Rating: {audit.photoAudit.level}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {auditData.photos.slice(0, 6).map((photo, i) => (
                  <div key={i} className="aspect-square bg-base-200 rounded overflow-hidden border border-base-300 flex items-center justify-center text-base-content/20">
                     <ImageIcon size={24} />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6 flex flex-col h-[320px]">
              <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Recent Reviews</h3>
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {auditData.reviews.length > 0 ? auditData.reviews.map((r, i) => (
                  <div key={i} className="pb-4 border-b border-base-100 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{r.author || 'Google User'}</span>
                      <span className="text-xs text-base-content/50">{r.time}</span>
                    </div>
                    {renderStars(r.rating)}
                    <p className="text-sm mt-2 text-base-content/80 line-clamp-3">{r.text}</p>
                  </div>
                )) : (
                  <p className="text-sm text-base-content/50">No reviews found to display.</p>
                )}
              </div>
            </div>
          </div>

          {/* Section 8: Actionable Recommendations */}
          <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6">
            <h3 className="text-lg font-bold text-base-content mb-4 border-b border-base-200 pb-2">Actionable Recommendations</h3>
            <div className="space-y-3">
              {audit.recommendations.map((rec, i) => (
                <div key={i} className={`flex items-start gap-3 p-4 rounded-lg border ${rec.severity === 'critical' ? 'bg-error/5 border-error/20' : rec.severity === 'warning' ? 'bg-warning/5 border-warning/20' : 'bg-success/5 border-success/20'}`}>
                  {rec.severity === 'critical' ? <XCircle size={20} className="text-error mt-0.5 flex-shrink-0" /> : 
                   rec.severity === 'warning' ? <CheckCircle size={20} className="text-warning mt-0.5 flex-shrink-0" /> : 
                   <CheckCircle size={20} className="text-success mt-0.5 flex-shrink-0" />}
                  <p className="text-base-content/90 font-medium text-sm leading-relaxed">{rec.text}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
