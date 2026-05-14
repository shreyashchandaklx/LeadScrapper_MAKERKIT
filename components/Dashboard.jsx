import React from 'react';
import { Users, FileText, Mail, DollarSign, TrendingUp, Target, ArrowUpRight, BarChart3 } from 'lucide-react';
import { getScoreColor, getScoreLabel, formatDate, getStatusBadge } from '../utils/helpers.js';

export const Dashboard = ({ leads, emails, reports, onNavigate }) => {
  const stats = {
    total_leads: leads.length,
    reports_generated: reports.length,
    emails_sent: emails.length,
    deals_closed: leads.filter(l => l.status === 'closed').length,
    avg_score: leads.length ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0,
    leads_this_week: leads.filter(l => Date.now() - new Date(l.created_at).getTime() < 7 * 86400000).length,
  };

  const hotLeads = [...leads].sort((a, b) => b.score - a.score).slice(0, 5);
  const recentEmails = [...emails].sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()).slice(0, 5);

  const statCards = [
    { label: 'Total Leads', value: stats.total_leads, icon: <Users size={18} />, color: 'text-base-content' },
    { label: 'Reports Generated', value: stats.reports_generated, icon: <FileText size={18} />, color: 'text-base-content/70' },
    { label: 'Emails Sent', value: stats.emails_sent, icon: <Mail size={18} />, color: 'text-warning' },
    { label: 'Deals Closed', value: stats.deals_closed, icon: <DollarSign size={18} />, color: 'text-success' },
    { label: 'Avg Lead Score', value: stats.avg_score, icon: <Target size={18} />, color: 'text-secondary' },
    { label: 'Leads This Week', value: stats.leads_this_week, icon: <TrendingUp size={18} />, color: 'text-base-content' },
  ];

  const statusCounts = {
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    interested: leads.filter(l => l.status === 'interested').length,
    closed: leads.filter(l => l.status === 'closed').length,
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {statCards.map(card => (
          <div key={card.label} className="border border-base-300 rounded bg-base-100">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className={`${card.color}`}>{card.icon}</span>
                <ArrowUpRight size={12} className="text-success" />
              </div>
              <p className="text-2xl font-bold text-base-content" style={{fontFamily:"'Inter',sans-serif"}}>{card.value}</p>
              <p className="text-xs text-base-content/50 mt-1" style={{fontFamily:"'Inter',sans-serif",letterSpacing:'.04em'}}>{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline + Hot Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline */}
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <h3 className="font-semibold text-base-content flex items-center gap-2 text-sm"><BarChart3 size={15} /> Sales Pipeline</h3>
            <div className="space-y-3 mt-3">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="flex items-center gap-3">
                  <span className={`badge ${getStatusBadge(status)} badge-sm capitalize w-20 text-[10px]`}>{status}</span>
                  <div className="flex-1 bg-base-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${status === 'new' ? 'bg-neutral' : status === 'contacted' ? 'bg-warning' : status === 'interested' ? 'bg-secondary' : 'bg-success'}`}
                      style={{ width: `${leads.length ? (count / leads.length) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm text-base-content/50 w-8 text-right font-mono">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hot Leads */}
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-base-content flex items-center gap-2 text-sm"><Target size={15} /> Hottest Leads</h3>
              <button className="text-xs text-base-content/40 hover:text-base-content transition-colors" onClick={() => onNavigate('leads')}>View All</button>
            </div>
            <div className="space-y-1.5 mt-3">
              {hotLeads.map(lead => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between p-2.5 rounded border border-transparent hover:border-base-300 cursor-pointer transition-colors"
                  onClick={() => onNavigate('detail', lead.id)}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-base-content truncate">{lead.business_name}</p>
                    <p className="text-xs text-base-content/40">{lead.category} &middot; {lead.city}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <span className={`text-sm font-bold ${getScoreColor(lead.score)}`}>{lead.score}</span>
                    <p className="text-[10px] text-base-content/40 font-mono">{getScoreLabel(lead.score)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Emails */}
      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-base-content flex items-center gap-2 text-sm"><Mail size={15} /> Recent Emails</h3>
            <button className="text-xs text-base-content/40 hover:text-base-content transition-colors" onClick={() => onNavigate('outreach')}>View All</button>
          </div>
          {recentEmails.length === 0 ? (
            <p className="text-sm text-base-content/40 mt-3">No emails sent yet</p>
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th className="text-base-content/40 text-[10px] uppercase font-medium tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Business</th>
                    <th className="text-base-content/40 text-[10px] uppercase font-medium tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Subject</th>
                    <th className="text-base-content/40 text-[10px] uppercase font-medium tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Status</th>
                    <th className="text-base-content/40 text-[10px] uppercase font-medium tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEmails.map(em => (
                    <tr key={em.id} className="border-b border-base-200 last:border-0">
                      <td className="text-sm">{em.lead_name}</td>
                      <td className="text-sm truncate max-w-[200px]">{em.subject}</td>
                      <td><span className={`badge badge-sm ${em.status === 'opened' ? 'badge-success' : em.status === 'replied' ? 'badge-secondary' : em.status === 'bounced' ? 'badge-error' : 'badge-ghost'}`}>{em.status}</span></td>
                      <td className="text-xs text-base-content/40">{formatDate(em.sent_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
