import React, { useState, useMemo, useEffect } from 'react';
import { Users, List, LayoutGrid, Search, Eye, Mail, Trash2, MessageSquare, Star, Calendar, Filter, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Hash, Building, MapPin, Globe, Phone, ShieldCheck, ShieldX, DollarSign, Tag, AlertTriangle, Bookmark, ExternalLink, MapPinned, Clock, Image, Ban, Download, Loader2 } from 'lucide-react';
import { getScoreColor, getScoreLabel, getStatusBadge, formatDate } from '../utils/helpers.js';

const ALL_COL_CONFIG = [
  { key: 'business_name', label: 'Business Name', icon: Building },
  { key: 'sites', label: 'Sites', icon: Globe },
  { key: 'category', label: 'Category', icon: Tag },
  { key: 'score', label: 'Lead Score', icon: AlertTriangle },
  { key: 'status', label: 'Status', icon: Bookmark },
  { key: 'address', label: 'Address', icon: MapPin },
  { key: 'neighborhood', label: 'Neighborhood', icon: MapPinned },
  { key: 'city', label: 'City', icon: MapPin },
  { key: 'state', label: 'State', icon: MapPin },
  { key: 'postal_code', label: 'Zip', icon: Hash },
  { key: 'country', label: 'Country', icon: Globe },
  { key: 'phone', label: 'Phone', icon: Phone },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'website', label: 'Website', icon: Globe },
  { key: 'rating', label: 'Rating', icon: Star },
  { key: 'review_count', label: 'Reviews', icon: Hash },
  { key: 'gbp_claimed', label: 'GBP Status', icon: ShieldCheck },
  { key: 'has_ssl', label: 'SSL', icon: ShieldCheck },
  { key: 'issues', label: 'Issues Found', icon: AlertTriangle },
  { key: 'price_level', label: 'Price', icon: DollarSign },
  { key: 'description', label: 'Description', icon: MessageSquare },
  { key: 'opening_hours', label: 'Hours', icon: Clock },
  { key: 'all_categories', label: 'All Categories', icon: Tag },
  { key: 'images_count', label: 'Images', icon: Image },
  { key: 'permanently_closed', label: 'Status (Open/Closed)', icon: Ban },
  { key: 'place_id', label: 'Place ID', icon: Hash },
  { key: 'maps_url', label: 'Maps Link', icon: ExternalLink },
  { key: 'follow_up_date', label: 'Follow Up', icon: Calendar },
];

const DEFAULT_VISIBLE = ['business_name', 'sites', 'category', 'score', 'status', 'address', 'email', 'rating', 'review_count', 'follow_up_date'];
const PAGE_SIZE = 20;

export const LeadManager = ({ leads, onViewDetail, onUpdateStatus, onUpdateNotes, onDeleteLead, onGenerateEmail, onGenerateSites, siteGen, onCancelSiteGen }) => {
  const [view, setView] = useState('list');
  const [search, setSearch] = useState('');
  const [editingNotes, setEditingNotes] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [visibleCols, setVisibleCols] = useState(DEFAULT_VISIBLE);
  const [showColPicker, setShowColPicker] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());

  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const filtered = useMemo(() => {
    if (!search) return leads;
    return leads.filter(l => l.business_name.toLowerCase().includes(search.toLowerCase()) || l.category.toLowerCase().includes(search.toLowerCase()));
  }, [leads, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Reset to page 1 when search/view changes or page falls outside range.
  useEffect(() => { setPage(1); }, [search, view]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paginated = useMemo(() => {
    if (view !== 'list') return filtered;
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page, view]);

  const columns = [
    { status: 'new', label: 'New', color: 'border-base-content/30' },
    { status: 'contacted', label: 'Contacted', color: 'border-warning' },
    { status: 'interested', label: 'Interested', color: 'border-secondary' },
    { status: 'closed', label: 'Closed', color: 'border-success' },
  ];

  const handleDrop = (e, status) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId) onUpdateStatus(leadId, status);
  };

  const startEditNotes = (lead) => {
    setEditingNotes(lead.id);
    setNoteText(lead.notes);
  };

  const saveNotes = () => {
    if (editingNotes) {
      onUpdateNotes(editingNotes, noteText);
      setEditingNotes(null);
    }
  };

  const exportCSV = () => {
    const headers = ALL_COL_CONFIG.map(c => c.label).join(',');

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      if (typeof val === 'boolean') return val ? '"Yes"' : '"No"';
      if (Array.isArray(val)) {
        return `"${val.join('; ').replace(/"/g, '""')}"`;
      }
      const s = String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = filtered.map(l => {
      return ALL_COL_CONFIG.map(c => escapeCsv(l[c.key])).join(',');
    });

    const blob = new Blob([[headers, ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved_leads_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const KanbanCard = ({ lead }) => (
    <div
      draggable
      onDragStart={e => e.dataTransfer.setData('text/plain', lead.id)}
      className="border border-base-300 bg-base-100 rounded cursor-grab active:cursor-grabbing"
    >
      <div className="p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-base-content truncate flex-1">{lead.business_name}</p>
          <span className={`text-xs font-bold ${getScoreColor(lead.score)}`}>{lead.score}</span>
        </div>
        <p className="text-xs text-base-content/40">{lead.category} &middot; {lead.city}</p>

        {lead.phone && (
          <div className="flex items-center gap-1.5 text-[11px] text-base-content/60">
            <Phone size={10} />
            <span>{lead.phone}</span>
          </div>
        )}

        {lead.address && (
          <div className="flex items-center gap-1.5 text-[11px] text-base-content/40">
            <MapPin size={10} />
            <span className="truncate">{lead.address}</span>
          </div>
        )}

        {lead.rating > 0 && (
          <div className="flex items-center gap-1">
            <Star size={10} className="text-warning" fill="currentColor" />
            <span className="text-xs font-bold text-base-content/60">{lead.rating}</span>
            <span className="text-[10px] text-base-content/30">({lead.review_count})</span>
          </div>
        )}
        {lead.follow_up_date && (
          <div className="flex items-center gap-1 text-xs text-base-content/40">
            <Calendar size={10} /> Follow up: {lead.follow_up_date}
          </div>
        )}
        {lead.notes && <p className="text-xs text-base-content/40 truncate">{lead.notes}</p>}
        <div className="flex gap-1 pt-1">
          <button className="btn btn-ghost btn-xs" onClick={() => onViewDetail(lead.id)}><Eye size={11} /></button>
          <button className="btn btn-ghost btn-xs" onClick={() => onGenerateEmail(lead.id)}><Mail size={11} /></button>
          <button className="btn btn-ghost btn-xs" onClick={() => startEditNotes(lead)}><MessageSquare size={11} /></button>
          <button className="btn btn-ghost btn-xs text-error" onClick={() => onDeleteLead(lead.id)}><Trash2 size={11} /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap border border-base-300 bg-base-100 p-4 rounded">
        <label className="input input-bordered input-sm flex items-center gap-2 flex-1 max-w-xs bg-base-100">
          <Search className="h-[1em] opacity-40" />
          <input className="grow" placeholder="Search saved leads..." value={search} onChange={e => setSearch(e.target.value)} />
        </label>

        <div className="flex gap-0.5 border border-base-300 rounded p-0.5">
          <button className={`btn btn-xs ${view === 'kanban' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('kanban')}><LayoutGrid size={13} /> Kanban</button>
          <button className={`btn btn-xs ${view === 'list' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('list')}><List size={13} /> List</button>
        </div>

        {view === 'list' && (
          <div className="relative">
            <button onClick={() => setShowColPicker(!showColPicker)}
              className="btn btn-sm btn-ghost border border-base-300 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Columns ({visibleCols.length})
              {showColPicker ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showColPicker && (
              <div className="absolute z-50 top-11 right-0 bg-base-100 border border-base-300 rounded p-4 shadow-lg grid grid-cols-2 md:grid-cols-3 gap-2 min-w-[400px]">
                <div className="col-span-2 md:col-span-3 flex gap-2 mb-2 border-b border-base-300 pb-2">
                  <button onClick={() => setVisibleCols(ALL_COL_CONFIG.map(c => c.key))} className="text-xs text-base-content hover:underline">Show All</button>
                  <button onClick={() => setVisibleCols(DEFAULT_VISIBLE)} className="text-xs text-secondary hover:underline">Reset Default</button>
                  <button onClick={() => setVisibleCols(['business_name', 'score', 'status'])} className="text-xs text-base-content/40 hover:underline">Minimal</button>
                </div>
                {ALL_COL_CONFIG.map(col => (
                  <label key={col.key} className="flex items-center gap-2 text-xs text-base-content/70 cursor-pointer hover:bg-base-200 rounded px-2 py-1">
                    <input type="checkbox" checked={visibleCols.includes(col.key)}
                      onChange={() => setVisibleCols(prev => prev.includes(col.key) ? prev.filter(c => c !== col.key) : [...prev, col.key])}
                      className="checkbox checkbox-xs border-base-300" />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {typeof onGenerateSites === 'function' && (
          <button
            onClick={() => {
              const ids = selected.size > 0 ? [...selected] : filtered.map(l => l.id);
              const byId = new Map(leads.map(l => [l.id, l]));
              const picked = ids.map(id => byId.get(id)).filter(Boolean);
              onGenerateSites(picked);
            }}
            disabled={siteGen?.active || filtered.length === 0}
            className="btn btn-sm btn-primary font-medium flex items-center gap-2"
            title={selected.size > 0 ? `Generate sites for ${selected.size} selected lead${selected.size === 1 ? '' : 's'}` : `Generate sites for all ${filtered.length} filtered leads`}
          >
            {siteGen?.active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Generate Sites ({selected.size > 0 ? selected.size : filtered.length})
          </button>
        )}

        <button onClick={exportCSV} className="btn btn-sm border border-base-300 bg-base-100 hover:bg-base-200 text-base-content flex items-center gap-2">
          <Download size={13} /> Export CSV
        </button>

        <span className="text-sm text-base-content/40 font-mono">{filtered.length} leads{selected.size > 0 ? ` · ${selected.size} selected` : ''}</span>
      </div>

      {/* Site Generation Progress */}
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
              <div className="w-full h-1.5 rounded-full bg-base-200 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(siteGen.completed / siteGen.total) * 100}%` }} />
              </div>
              {siteGen.errors?.length > 0 && (
                <p className="text-xs text-error mt-1">{siteGen.errors.length} error{siteGen.errors.length === 1 ? '' : 's'} so far</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {editingNotes && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="border border-base-300 rounded bg-base-100 w-full max-w-md shadow-lg">
            <div className="p-4">
              <h3 className="font-semibold text-sm mb-3">Edit Notes</h3>
              <textarea className="textarea textarea-bordered w-full h-24" value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add notes about this lead..." />
              <div className="flex gap-2 justify-end mt-3">
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingNotes(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveNotes}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kanban View */}
      {view === 'kanban' ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {columns.map(col => {
            const colLeads = filtered.filter(l => l.status === col.status);
            return (
              <div
                key={col.status}
                className={`bg-base-200 rounded p-3 border-t-2 ${col.color} min-h-[200px]`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, col.status)}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-base-content">{col.label}</h3>
                  <span className="text-[10px] text-base-content/40 font-mono">{colLeads.length}</span>
                </div>
                <div className="space-y-2">
                  {colLeads.map(lead => <KanbanCard key={lead.id} lead={lead} />)}
                  {colLeads.length === 0 && <p className="text-xs text-base-content/30 text-center py-4">Drop leads here</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="bg-base-100 rounded border border-base-300 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table table-sm w-full">
              <thead>
                <tr className="bg-base-200">
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={paginated.length > 0 && paginated.every(l => selected.has(l.id))}
                      onChange={() => {
                        const allOn = paginated.length > 0 && paginated.every(l => selected.has(l.id));
                        setSelected(prev => {
                          const next = new Set(prev);
                          paginated.forEach(l => allOn ? next.delete(l.id) : next.add(l.id));
                          return next;
                        });
                      }}
                      title="Select page"
                    />
                  </th>
                  {ALL_COL_CONFIG.filter(c => visibleCols.includes(c.key)).map(col => (
                    <th key={col.key} className="whitespace-nowrap text-[10px] font-medium tracking-wider uppercase" style={{fontFamily:"'Inter',sans-serif",color:'#9CA3AF'}}>
                      <div className="flex items-center gap-1">
                        <col.icon size={11} className="opacity-30" />
                        {col.label}
                      </div>
                    </th>
                  ))}
                  <th className="whitespace-nowrap text-[10px] font-medium tracking-wider uppercase text-center" style={{fontFamily:"'Inter',sans-serif",color:'#9CA3AF'}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(lead => {
                  const isSel = selected.has(lead.id);
                  return (
                    <tr key={lead.id} className={`hover hover:bg-base-200/30 transition-colors border-b border-base-200 last:border-0 ${isSel ? 'bg-base-200/40' : ''}`}>
                      <td className="px-3">
                        <input type="checkbox" className="checkbox checkbox-xs" checked={isSel} onChange={() => toggleRow(lead.id)} />
                      </td>
                      {visibleCols.includes('business_name') && (
                        <td className="min-w-[200px]">
                          <p className="font-medium text-base-content">{lead.business_name}</p>
                          <p className="text-[10px] text-base-content/30 leading-tight">{lead.city}, {lead.state}</p>
                        </td>
                      )}
                      {visibleCols.includes('sites') && (
                        <td className="px-3">
                          <div className="flex gap-2">
                            {lead.tier1 && (
                              <a href={lead.tier1_short || lead.tier1} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-success hover:underline" title="Basic Tier">
                                <Globe size={10} /> B
                              </a>
                            )}
                            {lead.tier2 && (
                              <a href={lead.tier2_short || lead.tier2} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-secondary hover:underline" title="Gold Tier">
                                <Globe size={10} /> G
                              </a>
                            )}
                            {lead.tier3 && (
                              <a href={lead.tier3_short || lead.tier3} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline" title="Premium Tier">
                                <Globe size={10} /> P
                              </a>
                            )}
                            {!lead.tier1 && !lead.tier2 && !lead.tier3 && <span className="text-[10px] text-base-content/20">—</span>}
                          </div>
                        </td>
                      )}
                    {visibleCols.includes('category') && (
                      <td><span className="text-xs text-base-content/60 bg-base-200 px-2 py-0.5 rounded">{lead.category}</span></td>
                    )}
                    {visibleCols.includes('score') && (
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-1 rounded-full bg-base-200 overflow-hidden">
                            <div className={`h-full rounded-full ${lead.score >= 70 ? 'bg-error' : lead.score >= 40 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${lead.score}%` }} />
                          </div>
                          <span className={`font-bold text-xs ${getScoreColor(lead.score)}`}>{lead.score}</span>
                        </div>
                      </td>
                    )}
                    {visibleCols.includes('status') && (
                      <td>
                        <select
                          className={`select select-xs ${getStatusBadge(lead.status)} bg-base-100 border border-base-300 font-medium text-[10px] h-7`}
                          value={lead.status}
                          onChange={e => onUpdateStatus(lead.id, e.target.value)}
                        >
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="interested">Interested</option>
                          <option value="closed">Closed</option>
                          <option value="lost">Lost</option>
                        </select>
                      </td>
                    )}
                    {visibleCols.includes('address') && (
                      <td className="text-[10px] text-base-content/50 max-w-[150px] truncate">{lead.address || '—'}</td>
                    )}
                    {visibleCols.includes('neighborhood') && (
                      <td className="text-[10px] text-base-content/40">{lead.neighborhood || '—'}</td>
                    )}
                    {visibleCols.includes('city') && (
                        <td className="text-[10px] text-base-content/50">{lead.city || '—'}</td>
                    )}
                    {visibleCols.includes('state') && (
                        <td className="text-[10px] text-base-content/50">{lead.state || '—'}</td>
                    )}
                    {visibleCols.includes('postal_code') && (
                        <td className="text-[10px] text-base-content/30 font-mono">{lead.postal_code || '—'}</td>
                    )}
                    {visibleCols.includes('country') && (
                        <td className="text-[10px] text-base-content/30 uppercase font-mono">{lead.country || '—'}</td>
                    )}
                    {visibleCols.includes('phone') && (
                      <td className="whitespace-nowrap">
                        {lead.phone ? <span className="text-[10px] text-base-content/60">{lead.phone}</span> : <span className="text-base-content/20">—</span>}
                      </td>
                    )}
                    {visibleCols.includes('email') && (
                      <td className="whitespace-nowrap">
                        {lead.email ? <span className="text-[10px] text-success">{lead.email}</span> : <span className="text-base-content/20">—</span>}
                      </td>
                    )}
                    {visibleCols.includes('website') && (
                      <td>
                        {lead.website ? (
                          <a href={lead.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-base-content/50 hover:text-base-content hover:underline truncate max-w-[120px]">
                            {lead.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                            <ExternalLink size={9} />
                          </a>
                        ) : <span className="text-[10px] text-error/60">No Site</span>}
                      </td>
                    )}
                    {visibleCols.includes('rating') && (
                      <td>
                        {lead.rating > 0 ? (
                          <span className="flex items-center gap-1 text-xs font-bold whitespace-nowrap">
                            <Star size={11} className="text-warning" fill="currentColor" />{lead.rating}
                          </span>
                        ) : <span className="text-base-content/20">—</span>}
                      </td>
                    )}
                    {visibleCols.includes('review_count') && (
                      <td>
                        <span className={`text-xs font-mono font-bold ${lead.review_count < 10 ? 'text-error' : lead.review_count < 50 ? 'text-warning' : 'text-success'}`}>
                          {lead.review_count?.toLocaleString() || 0}
                        </span>
                      </td>
                    )}
                    {visibleCols.includes('gbp_claimed') && (
                      <td>
                        {lead.gbp_claimed ? (
                          <span className="text-[10px] text-success flex items-center gap-1"><ShieldCheck size={10} /> Claimed</span>
                        ) : (
                          <span className="text-[10px] text-error flex items-center gap-1"><ShieldX size={10} /> Unclaimed</span>
                        )}
                      </td>
                    )}
                    {visibleCols.includes('has_ssl') && (
                      <td>
                        {lead.has_ssl ? (
                          <span className="text-[10px] text-success">SSL OK</span>
                        ) : (
                          <span className="text-[10px] text-error">No SSL</span>
                        )}
                      </td>
                    )}
                    {visibleCols.includes('issues') && (
                      <td>
                        {lead.issues && lead.issues.length > 0 ? (
                          <div className="flex flex-wrap gap-0.5 max-w-[150px]">
                            {lead.issues.slice(0, 1).map((issue, j) => (
                              <span key={j} className="text-[10px] text-error bg-error/5 px-1.5 py-0.5 rounded border border-error/10 whitespace-nowrap">{issue.split(' ')[0]}...</span>
                            ))}
                            {lead.issues.length > 1 && <span className="text-[10px] text-base-content/30">+{lead.issues.length - 1}</span>}
                          </div>
                        ) : <span className="text-[10px] text-success">Audit OK</span>}
                      </td>
                    )}
                    {visibleCols.includes('price_level') && (
                      <td className="text-xs text-warning">{lead.price_level || '—'}</td>
                    )}
                    {visibleCols.includes('description') && (
                      <td className="text-[10px] text-base-content/30 max-w-[150px] truncate">{lead.description || '—'}</td>
                    )}
                    {visibleCols.includes('opening_hours') && (
                      <td className="text-[10px] text-base-content/30 max-w-[150px] truncate">{lead.opening_hours || '—'}</td>
                    )}
                    {visibleCols.includes('all_categories') && (
                      <td className="text-[10px] text-base-content/30 max-w-[150px] truncate">{(lead.all_categories || []).join(', ') || '—'}</td>
                    )}
                    {visibleCols.includes('images_count') && (
                      <td className="text-[10px] text-base-content/50">{(lead.images_count || 0).toLocaleString()}</td>
                    )}
                    {visibleCols.includes('permanently_closed') && (
                      <td>
                        {lead.permanently_closed ? (
                          <span className="text-[10px] text-error">Closed</span>
                        ) : (
                          <span className="text-[10px] text-success">Open</span>
                        )}
                      </td>
                    )}
                    {visibleCols.includes('place_id') && (
                      <td className="text-[10px] text-base-content/20 font-mono truncate max-w-[80px]">{lead.place_id || '—'}</td>
                    )}
                    {visibleCols.includes('maps_url') && (
                      <td>
                        {lead.maps_url ? (
                          <a href={lead.maps_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs btn-square">
                            <ExternalLink size={10} />
                          </a>
                        ) : '—'}
                      </td>
                    )}
                    {visibleCols.includes('follow_up_date') && (
                      <td className="text-[10px] text-base-content/30 whitespace-nowrap font-mono">{lead.follow_up_date || '—'}</td>
                    )}
                    <td className="text-center">
                      <div className="flex gap-0.5 justify-center">
                        <button className="btn btn-ghost btn-xs btn-square hover:bg-base-200 transition-colors" onClick={() => onViewDetail(lead.id)} title="View Detail"><Eye size={11} /></button>
                        <button className="btn btn-ghost btn-xs btn-square hover:bg-base-200 transition-colors" onClick={() => onGenerateEmail(lead.id)} title="Email"><Mail size={11} /></button>
                        <button className="btn btn-ghost btn-xs btn-square hover:bg-base-200 transition-colors" onClick={() => startEditNotes(lead)} title="Notes"><MessageSquare size={11} /></button>
                        <button className="btn btn-ghost btn-xs btn-square text-error/30 hover:text-error hover:bg-error/5" onClick={() => onDeleteLead(lead.id)} title="Delete"><Trash2 size={11} /></button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-base-300 text-xs text-base-content/60">
              <span>
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                >First</button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                ><ChevronLeft size={13} /></button>
                <span className="font-mono px-2">Page {page} / {totalPages}</span>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                ><ChevronRight size={13} /></button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                >Last</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
