import React, { useState, useMemo } from 'react';
import { Mail, Sparkles, Copy, Send, Check, RefreshCw } from 'lucide-react';
import { emailTemplates } from '../utils/mockData.js';
import { fillTemplate, auditLead } from '../utils/helpers.js';

export const EmailGenerator = ({ leads, selectedLeadId, onSendEmail }) => {
  const [leadId, setLeadId] = useState(selectedLeadId || '');
  const [templateId, setTemplateId] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [tone, setTone] = useState('professional');

  const lead = useMemo(() => {
    const found = leads.find(l => l.id === leadId);
    if (found && found.email && !toEmail) setToEmail(found.email);
    return found;
  }, [leads, leadId]);

  const applyTemplate = (tId) => {
    const template = emailTemplates.find(t => t.id === tId);
    if (template && lead) {
      setTemplateId(tId);
      setSubject(fillTemplate(template.subject, lead));
      setBody(fillTemplate(template.body, lead));
    }
  };

  const generateAI = () => {
    if (!lead) return;
    setGenerating(true);
    const audit = auditLead(lead);
    const issues = audit.issues.slice(0, 3);

    setTimeout(() => {
      const tonePrefix = tone === 'casual' ? 'Hey' : tone === 'urgent' ? 'URGENT:' : 'Hi';
      const toneClose = tone === 'casual' ? 'Cheers' : tone === 'urgent' ? 'Looking forward to your quick reply' : 'Best regards';

      setSubject(`${tone === 'urgent' ? '' : ''}${lead.business_name} is missing out on local customers — I can help`);
      setBody(`${tonePrefix} ${lead.owner_name},

I was researching ${lead.category.toLowerCase()} businesses in ${lead.city} and came across ${lead.business_name}. I noticed a few opportunities that could significantly boost your online visibility and bring in more customers:

${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

${audit.issues.length > 3 ? `...and ${audit.issues.length - 3} more areas for improvement.\n` : ''}I specialize in helping local businesses like yours fix these exact issues. My clients typically see a 40-60% increase in online visibility within the first 90 days.

I'd love to put together a free, no-obligation audit report for ${lead.business_name} showing exactly what's holding you back and how to fix it.

Would you be open to a quick 10-minute call this week to discuss?

${toneClose},
[Your Name]
[Your Agency]
[Your Phone]`);
      setGenerating(false);
    }, 1200);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = () => {
    if (lead && subject && body && fromEmail && toEmail) {
      onSendEmail(lead.id, subject, body, fromEmail, toEmail);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-base-content flex items-center gap-2"><Sparkles size={18} className="text-secondary" /> AI Cold Email Generator</h2>
      </div>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Select Lead</label>
              <select className="select select-bordered select-sm w-full" value={leadId} onChange={e => setLeadId(e.target.value)}>
                <option value="">Choose a lead...</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.business_name} — {l.city}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Email Template</label>
              <select className="select select-bordered select-sm w-full" value={templateId} onChange={e => applyTemplate(e.target.value)} disabled={!lead}>
                <option value="">Choose template or generate with AI...</option>
                {emailTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Tone</label>
              <select className="select select-bordered select-sm" value={tone} onChange={e => setTone(e.target.value)}>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={generateAI} disabled={!lead || generating}>
              {generating ? <span className="loading loading-spinner loading-sm" /> : <><Sparkles size={13} /> Generate with AI</>}
            </button>
          </div>
        </div>
      </div>

      {lead && (
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{lead.business_name}</p>
                <p className="text-xs text-base-content/40">{lead.email || 'No email found'} &middot; {lead.category} &middot; {lead.city}</p>
              </div>
              <span className={`badge badge-sm ${lead.gbp_claimed ? 'badge-success' : 'badge-error'}`}>Score: {lead.score}</span>
            </div>
          </div>
        </div>
      )}

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>From (Your Email)</label>
              <input className="input input-bordered input-sm w-full" value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="you@youragency.com" />
            </div>
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>To (Recipient Email)</label>
              <input className="input input-bordered input-sm w-full" value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="business@example.com" />
            </div>
          </div>
        </div>
      </div>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Subject Line</label>
            <input className="input input-bordered input-sm w-full" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject..." />
          </div>
          <div>
            <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Email Body</label>
            <textarea className="textarea textarea-bordered w-full h-64 text-sm" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your email or click 'Generate with AI'..." />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={!subject || !body || !lead || !fromEmail || !toEmail}>
              {sent ? <><Check size={13} /> Sent!</> : <><Send size={13} /> Send Email</>}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={copyToClipboard} disabled={!subject && !body}>
              {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={generateAI} disabled={!lead || generating}>
              <RefreshCw size={13} /> Regenerate
            </button>
          </div>
        </div>
      </div>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4">
          <h3 className="font-semibold text-base-content mb-3 text-sm">Email Template Library</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {emailTemplates.map(t => (
              <div key={t.id} className="p-3 border border-base-200 rounded cursor-pointer hover:border-base-300 transition-colors" onClick={() => { if (lead) applyTemplate(t.id); }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-base-content">{t.name}</span>
                  <span className="text-[10px] text-base-content/40 font-mono uppercase">{t.category}</span>
                </div>
                <p className="text-xs text-base-content/50 truncate">{t.subject}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
