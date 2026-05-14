import React, { useState, useMemo } from 'react';
import { Send, Search, Mail, Clock, CheckCircle, XCircle, MailOpen, Reply } from 'lucide-react';
import { formatDate } from '../utils/helpers.js';

export const EmailOutreach = ({ emails }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    let result = [...emails];
    if (search) result = result.filter(e => e.lead_name.toLowerCase().includes(search.toLowerCase()) || e.subject.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter !== 'all') result = result.filter(e => e.status === statusFilter);
    return result.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());
  }, [emails, search, statusFilter]);

  const selectedEmail = selected ? emails.find(e => e.id === selected) : null;

  const stats = {
    total: emails.length,
    sent: emails.filter(e => e.status === 'sent').length,
    opened: emails.filter(e => e.status === 'opened').length,
    replied: emails.filter(e => e.status === 'replied').length,
    bounced: emails.filter(e => e.status === 'bounced').length,
  };

  const openRate = stats.total ? Math.round(((stats.opened + stats.replied) / stats.total) * 100) : 0;
  const replyRate = stats.total ? Math.round((stats.replied / stats.total) * 100) : 0;

  const StatusIcon = ({ status }) => {
    switch (status) {
      case 'sent': return <Clock size={13} className="text-base-content/40" />;
      case 'opened': return <MailOpen size={13} className="text-success" />;
      case 'replied': return <Reply size={13} className="text-secondary" />;
      case 'bounced': return <XCircle size={13} className="text-error" />;
      default: return <Mail size={13} />;
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <h2 className="text-lg font-bold text-base-content flex items-center gap-2"><Send size={18} className="text-base-content/60" /> Email Outreach</h2>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Total Sent', value: stats.total, icon: <Mail size={14} />, color: 'text-base-content' },
          { label: 'Delivered', value: stats.sent, icon: <CheckCircle size={14} />, color: 'text-success' },
          { label: 'Opened', value: stats.opened, icon: <MailOpen size={14} />, color: 'text-warning' },
          { label: 'Replied', value: stats.replied, icon: <Reply size={14} />, color: 'text-secondary' },
          { label: 'Bounced', value: stats.bounced, icon: <XCircle size={14} />, color: 'text-error' },
        ].map(s => (
          <div key={s.label} className="border border-base-300 rounded bg-base-100">
            <div className="p-3 items-center text-center">
              <span className={s.color}>{s.icon}</span>
              <p className="text-xl font-bold text-base-content mt-1" style={{fontFamily:"'Inter',sans-serif"}}>{s.value}</p>
              <p className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-3">
            <p className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">Open Rate</p>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold text-success" style={{fontFamily:"'Inter',sans-serif"}}>{openRate}%</span>
              <progress className="progress progress-success w-full" value={openRate} max={100} />
            </div>
          </div>
        </div>
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-3">
            <p className="text-[10px] text-base-content/40 font-mono uppercase tracking-wider">Reply Rate</p>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold text-secondary" style={{fontFamily:"'Inter',sans-serif"}}>{replyRate}%</span>
              <progress className="progress progress-secondary w-full" value={replyRate} max={100} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <label className="input input-bordered input-sm flex items-center gap-2 flex-1 max-w-xs">
          <Search className="h-[1em] opacity-40" />
          <input className="grow" placeholder="Search emails..." value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        <select className="select select-bordered select-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="sent">Sent</option>
          <option value="opened">Opened</option>
          <option value="replied">Replied</option>
          <option value="bounced">Bounced</option>
        </select>
      </div>

      <div className="border border-base-300 rounded bg-base-100">
        <div>
          {filtered.length === 0 ? (
            <p className="text-sm text-base-content/40 p-4">No emails found</p>
          ) : (
            <div className="divide-y divide-base-200">
              {filtered.map(email => (
                <div
                  key={email.id}
                  className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-base-200/50 transition-colors ${selected === email.id ? 'bg-base-200/50' : ''}`}
                  onClick={() => setSelected(selected === email.id ? null : email.id)}
                >
                  <StatusIcon status={email.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-base-content truncate">{email.lead_name}</p>
                    <p className="text-xs text-base-content/50 truncate">{email.subject}</p>
                    <div className="flex gap-3 mt-0.5">
                      {email.from_email && <p className="text-[10px] text-base-content/40 truncate">From: {email.from_email}</p>}
                      {email.to_email && <p className="text-[10px] text-base-content/40 truncate">To: {email.to_email}</p>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={`badge badge-xs ${email.status === 'opened' ? 'badge-success' : email.status === 'replied' ? 'badge-secondary' : email.status === 'bounced' ? 'badge-error' : 'badge-ghost'}`}>{email.status}</span>
                    <p className="text-[10px] text-base-content/40 mt-0.5 font-mono">{formatDate(email.sent_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedEmail && (
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <h3 className="font-semibold text-base-content text-sm">{selectedEmail.subject}</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <p className="text-[10px] text-base-content/40 font-mono">From: {selectedEmail.from_email || 'N/A'}</p>
              <p className="text-[10px] text-base-content/40 font-mono">To: {selectedEmail.to_email || selectedEmail.lead_name}</p>
              <p className="text-[10px] text-base-content/40 font-mono">Sent: {formatDate(selectedEmail.sent_at)}</p>
            </div>
            <div className="p-3 bg-base-200 rounded border border-base-300 text-sm text-base-content mt-2 whitespace-pre-wrap">{selectedEmail.body}</div>
          </div>
        </div>
      )}
    </div>
  );
};
