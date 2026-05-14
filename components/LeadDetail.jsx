import React from 'react';
import { ArrowLeft, CheckCircle, XCircle, Star, Globe, Phone, Mail, MapPin, Shield, Smartphone, Share2, Megaphone, TrendingUp, FileText, Send } from 'lucide-react';
import { getScoreColor, getScoreBg, getScoreLabel, auditLead } from '../utils/helpers.js';

export const LeadDetail = ({ lead, onBack, onGenerateEmail, onGenerateReport }) => {
  const audit = auditLead(lead);

  const AuditItem = ({ label, pass, detail, icon }) => (
    <div className={`flex items-center gap-3 p-3 rounded border ${pass ? 'border-success/20 bg-success/5' : 'border-error/20 bg-error/5'}`}>
      <span className="flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-base-content">{label}</p>
        <p className="text-xs text-base-content/50">{detail}</p>
      </div>
      {pass ? <CheckCircle size={16} className="text-success flex-shrink-0" /> : <XCircle size={16} className="text-error flex-shrink-0" />}
    </div>
  );

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm btn-circle" onClick={onBack}><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-base-content">{lead.business_name}</h2>
          <p className="text-sm text-base-content/50">{lead.category} &middot; {lead.city}, {lead.state}</p>
        </div>
        <div className={`text-center px-4 py-2 rounded ${getScoreBg(lead.score)}`}>
          <p className={`text-2xl font-bold ${getScoreColor(lead.score)}`} style={{fontFamily:"'Inter',sans-serif"}}>{lead.score}</p>
          <p className="text-[10px] text-base-content/50 font-mono">{getScoreLabel(lead.score)}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-primary btn-sm" onClick={() => onGenerateEmail(lead.id)}><Send size={13} /> Generate Email</button>
        <button className="btn btn-sm border border-base-300 bg-base-100 hover:bg-base-200 text-base-content" onClick={() => onGenerateReport(lead.id)}><FileText size={13} /> Generate Report</button>
      </div>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4">
          <h3 className="font-semibold text-base-content mb-3 text-sm">Contact Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {lead.owner_name && <div className="flex items-center gap-2 text-sm"><span className="text-base-content/40">Owner:</span> {lead.owner_name}</div>}
            {lead.address && <div className="flex items-center gap-2 text-sm"><MapPin size={13} className="opacity-40" /> {lead.address}</div>}
            {lead.phone && <div className="flex items-center gap-2 text-sm"><Phone size={13} className="opacity-40" /> {lead.phone}</div>}
            {lead.email && <div className="flex items-center gap-2 text-sm"><Mail size={13} className="opacity-40" /> {lead.email}</div>}
            {lead.website && <div className="flex items-center gap-2 text-sm"><Globe size={13} className="opacity-40" /> {lead.website}</div>}
            <div className="flex items-center gap-2 text-sm"><Star size={13} className="text-warning" fill="currentColor" /> {lead.rating > 0 ? `${lead.rating}/5.0 (${lead.review_count} reviews)` : 'No ratings'}</div>
          </div>
        </div>
      </div>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4">
          <h3 className="font-semibold text-base-content mb-3 text-sm">Business Audit</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AuditItem label="GBP Claimed" pass={audit.gbp_claimed} detail={audit.gbp_claimed ? 'Profile is claimed and active' : 'Profile not claimed — immediate opportunity'} icon={<TrendingUp size={14} className="opacity-40" />} />
            <AuditItem label="Website" pass={lead.has_website} detail={lead.has_website ? lead.website : 'No website found'} icon={<Globe size={14} className="opacity-40" />} />
            <AuditItem label="Mobile Responsive" pass={audit.mobile_responsive} detail={audit.mobile_responsive ? 'Website works on mobile' : 'Not mobile-optimized'} icon={<Smartphone size={14} className="opacity-40" />} />
            <AuditItem label="SSL Certificate" pass={audit.has_ssl} detail={audit.has_ssl ? 'HTTPS enabled' : 'No SSL — insecure site'} icon={<Shield size={14} className="opacity-40" />} />
            <AuditItem label="Social Media" pass={audit.has_social} detail={audit.has_social ? 'Active social profiles found' : 'No social presence'} icon={<Share2 size={14} className="opacity-40" />} />
            <AuditItem label="Google Ads" pass={audit.running_ads} detail={audit.running_ads ? 'Running paid campaigns' : 'No active ad spend'} icon={<Megaphone size={14} className="opacity-40" />} />
            <AuditItem label="Google 3-Pack" pass={!!audit.three_pack_rank} detail={audit.three_pack_rank ? `Ranking #${audit.three_pack_rank}` : 'Not in top results'} icon={<TrendingUp size={14} className="opacity-40" />} />
            <AuditItem label="Reviews" pass={audit.review_count >= 10} detail={`${audit.review_count} reviews — ${audit.review_sentiment} sentiment`} icon={<Star size={14} className="opacity-40" />} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <h3 className="font-semibold text-error mb-2 text-sm">Issues Found ({audit.issues.length})</h3>
            <ul className="space-y-1.5">
              {audit.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <XCircle size={13} className="text-error flex-shrink-0 mt-0.5" />
                  <span className="text-base-content/70">{issue}</span>
                </li>
              ))}
              {audit.issues.length === 0 && <li className="text-sm text-base-content/40">No major issues found</li>}
            </ul>
          </div>
        </div>
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <h3 className="font-semibold text-success mb-2 text-sm">Recommendations ({audit.recommendations.length})</h3>
            <ul className="space-y-1.5">
              {audit.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle size={13} className="text-success flex-shrink-0 mt-0.5" />
                  <span className="text-base-content/70">{rec}</span>
                </li>
              ))}
              {audit.recommendations.length === 0 && <li className="text-sm text-base-content/40">Business is well-optimized</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
