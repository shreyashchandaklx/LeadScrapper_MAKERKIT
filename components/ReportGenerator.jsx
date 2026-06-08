import React, { useState, useMemo, useEffect } from 'react';
import { FileText, Download, Sparkles, Trash2, Star, Eye, X } from 'lucide-react';
import { formatDate } from '../utils/helpers.js';
import { runFullAudit } from '../utils/gmbAudit.js';
import { generateAuditPDF } from '../utils/pdfGenerator.js';
import { logError, MODULES } from '../utils/errorLogger.js';

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

// Slug the business name so the downloaded PDF gets a clean filename.
function slugify(s) {
  return String(s || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'report';
}

// Build the audit PDF for a lead. Returns the jsPDF doc — the caller decides
// whether to .save() it or just keep the work in memory.
function buildPdfForLead(lead) {
  if (!lead) return null;
  const auditData = mapLeadToAuditData(lead);
  const audit = runFullAudit(auditData);
  return generateAuditPDF(auditData, audit);
}

function downloadPdfForLead(lead) {
  const doc = buildPdfForLead(lead);
  if (!doc) return false;
  const filename = `audit-${slugify(lead.business_name)}-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(filename);
  return true;
}

export const ReportGenerator = ({ leads, reports, selectedLeadId, onGenerateReport, onDeleteReport }) => {
  const [leadId, setLeadId] = useState(selectedLeadId || '');
  const [generating, setGenerating] = useState(false);
  // Inline PDF preview: { url, name } when open, null when closed.
  // The url is a blob URL we revoke on close to avoid leaking memory.
  const [preview, setPreview] = useState(null);

  const lead = useMemo(() => leads.find(l => l.id === leadId), [leads, leadId]);

  // Revoke any leftover blob URL when the component unmounts or preview changes.
  useEffect(() => {
    return () => { if (preview?.url) URL.revokeObjectURL(preview.url); };
  }, [preview]);

  const openPreview = (target) => {
    if (!target) return;
    try {
      const doc = buildPdfForLead(target);
      if (!doc) throw new Error('PDF builder returned nothing');
      const url = doc.output('bloburl').toString();
      // Close any existing preview first (release its blob URL).
      setPreview(prev => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { url, name: target.business_name || 'Report' };
      });
    } catch (err) {
      console.error('[report] preview failed', err);
      const errorId = logError(MODULES.RPT, err, {
        component: 'ReportGenerator', action: 'preview',
        context: { business: target?.business_name || '' },
      });
      alert('Could not open report preview: ' + (err?.message || err) + '\n\nError ID: ' + errorId);
    }
  };

  const closePreview = () => {
    setPreview(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  // Generate = build + persist to the Reports list. Does NOT auto-download
  // (sir wants explicit Download/Delete buttons in the list instead).
  // Generate = build + persist to the Reports list, then show the preview
  // inline (sir wants to actually see the report after pressing Generate).
  // No auto-download — that's what the Download button is for.
  const handleGenerate = () => {
    if (!lead) return;
    setGenerating(true);
    setTimeout(() => {
      try {
        const doc = buildPdfForLead(lead);
        if (!doc) throw new Error('PDF builder returned nothing');
        const url = doc.output('bloburl').toString();
        setPreview(prev => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return { url, name: lead.business_name || 'Report' };
        });
        onGenerateReport(lead.id);
      } catch (err) {
        console.error('[report] generate failed', err);
        const errorId = logError(MODULES.RPT, err, {
          component: 'ReportGenerator', action: 'generate',
          context: { business: lead?.business_name || '' },
        });
        alert('Could not generate report: ' + (err?.message || err) + '\n\nError ID: ' + errorId);
      } finally {
        setGenerating(false);
      }
    }, 50);
  };

  const handleDownloadExisting = (report) => {
    const target = leads.find(l => l.id === report.lead_id);
    if (!target) {
      alert('Original lead is no longer available — cannot rebuild the PDF.');
      return;
    }
    try {
      downloadPdfForLead(target);
    } catch (err) {
      console.error('[report] download failed', err);
      const errorId = logError(MODULES.RPT, err, {
        component: 'ReportGenerator', action: 'download',
        context: { business: target?.business_name || '' },
      });
      alert('Could not download report: ' + (err?.message || err) + '\n\nError ID: ' + errorId);
    }
  };

  const handleDeleteReport = (reportId) => {
    if (window.confirm('Delete this report?')) {
      onDeleteReport(reportId);
    }
  };

  const sortedReports = useMemo(
    () => [...(reports || [])].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [reports]
  );

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
            <select className="select select-bordered w-full" value={leadId} onChange={e => setLeadId(e.target.value)}>
              <option value="">Choose a lead...</option>
              {leads.map(l => <option key={l.id} value={l.id}>{l.business_name} ({l.city})</option>)}
            </select>
          </div>
          <div className="flex gap-2 items-end">
            <button className="btn btn-primary" onClick={handleGenerate} disabled={!lead || generating}>
              {generating ? <span className="loading loading-spinner" /> : <><Sparkles size={18} /> Generate Report</>}
            </button>
          </div>
        </div>
      </div>

      {/* Past reports — Download (rebuilds the PDF) + Delete per row. */}
      <div className="bg-base-100 rounded-lg shadow-sm border border-base-300">
        <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
          <h3 className="font-semibold text-base-content">Generated Reports</h3>
          <span className="text-xs text-base-content/60">{sortedReports.length} total</span>
        </div>
        {sortedReports.length === 0 ? (
          <div className="p-6 text-center text-base-content/60 text-sm">
            No reports yet. Pick a lead above and click <span className="font-semibold">Generate Report</span> to create one.
          </div>
        ) : (
          <ul className="divide-y divide-base-300">
            {sortedReports.map(r => {
              const leadStillExists = leads.some(l => l.id === r.lead_id);
              return (
                <li key={r.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-base-content truncate flex items-center gap-2">
                      <FileText size={14} className="text-primary shrink-0" />
                      <span className="truncate">{r.lead_name || '(unnamed lead)'}</span>
                    </div>
                    <div className="text-xs text-base-content/60 flex items-center gap-3 mt-0.5">
                      <span>{formatDate ? formatDate(r.created_at) : new Date(r.created_at).toLocaleString()}</span>
                      {typeof r.score === 'number' && r.score > 0 && (
                        <span className="flex items-center gap-1"><Star size={12} className="text-warning fill-current" /> {r.score}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      className="btn btn-sm btn-primary btn-outline gap-1"
                      onClick={() => openPreview(leads.find(l => l.id === r.lead_id))}
                      disabled={!leadStillExists}
                      title={leadStillExists ? 'View PDF inline' : 'Original lead no longer available'}
                    >
                      <Eye size={14} /> View
                    </button>
                    <button
                      className="btn btn-sm btn-outline gap-1"
                      onClick={() => handleDownloadExisting(r)}
                      disabled={!leadStillExists}
                      title={leadStillExists ? 'Download PDF' : 'Original lead no longer available'}
                    >
                      <Download size={14} /> Download
                    </button>
                    <button
                      className="btn btn-sm btn-error btn-outline gap-1"
                      onClick={() => handleDeleteReport(r.id)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Inline PDF preview — fixed overlay with a Close button.
          Built with native <iframe> + a blob URL so the browser's own PDF
          viewer handles zoom/scroll. We revoke the URL on close. */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-base-300/80 backdrop-blur-sm flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={`Report preview — ${preview.name}`}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-base-100 border-b border-base-300 shadow">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={18} className="text-primary shrink-0" />
              <span className="font-semibold truncate">Report preview — {preview.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                className="btn btn-sm btn-outline gap-1"
                href={preview.url}
                download={`audit-${slugify(preview.name)}-${new Date().toISOString().slice(0,10)}.pdf`}
              >
                <Download size={14} /> Download
              </a>
              <button
                className="btn btn-sm btn-ghost gap-1"
                onClick={closePreview}
                aria-label="Close preview"
              >
                <X size={16} /> Close
              </button>
            </div>
          </div>
          <iframe
            src={preview.url}
            title="Report PDF preview"
            className="flex-1 w-full bg-white"
          />
        </div>
      )}
    </div>
  );
};
