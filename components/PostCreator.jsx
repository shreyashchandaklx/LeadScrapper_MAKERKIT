import React, { useState } from 'react';
import { PenTool, Sparkles, Copy, Check, RefreshCw, Facebook, Globe, Hash } from 'lucide-react';

export const PostCreator = () => {
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('');
  const [platform, setPlatform] = useState('gbp');
  const [postType, setPostType] = useState('promotion');
  const [topic, setTopic] = useState('');
  const [post, setPost] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const platformLabels = { gbp: 'Google Business Profile', facebook: 'Facebook', yelp: 'Yelp' };
  const typeLabels = { promotion: 'Promotion', update: 'Business Update', event: 'Event', tip: 'Industry Tip' };

  const generate = () => {
    if (!businessName) return;
    setGenerating(true);

    setTimeout(() => {
      const biz = businessName;
      const cat = category || 'services';

      const posts = {
        promotion: [
          `Special Offer from ${biz}!\n\nThis month only — get 20% off all ${cat} services! Whether you need a quick fix or a complete overhaul, our expert team has you covered.\n\nLicensed & Insured\nSame-Day Service Available\n100% Satisfaction Guaranteed\n\nCall us today to claim your discount!\n\n#${cat.replace(/\s/g, '')} #LocalBusiness #SpecialOffer #${biz.replace(/\s/g, '')}`,
          `FLASH SALE! ${biz} is offering exclusive discounts this week!\n\nDon't miss out on premium ${cat} at unbeatable prices. Our team of experienced professionals is ready to help.\n\nLimited spots available — book now before they're gone!\n\nServing your local area\n5-star rated service\n\n#Deals #${cat.replace(/\s/g, '')} #LocalBusiness`,
        ],
        update: [
          `Exciting News from ${biz}!\n\nWe're thrilled to announce that we've expanded our ${cat} services! Now offering more options to serve you better.\n\nWhat's new:\n- Extended hours — now open Saturdays!\n- New team members with 10+ years experience\n- Faster turnaround times\n\nThank you for your continued support. We're committed to being the best ${cat} provider in the area!\n\n#BusinessUpdate #${cat.replace(/\s/g, '')} #GrowingBusiness`,
          `Hey neighbors!\n\n${biz} is still going strong and serving our amazing community with top-quality ${cat}.\n\nHere's what we've been up to:\n- Completed 50+ projects this month\n- Maintained our 5-star rating\n- Added new eco-friendly options\n\nGot a project in mind? Let's chat! We'd love to help.\n\n#CommunityFirst #${cat.replace(/\s/g, '')}`,
        ],
        event: [
          `Join us for a special event!\n\n${biz} is hosting a FREE ${cat} consultation day!\n\nDate: This Saturday\nTime: 10 AM – 4 PM\nAt our location\n\nGet expert advice, free estimates, and exclusive event-only discounts.\n\nNo appointment needed — just walk in!\n\nTag a friend who might be interested!\n\n#FreeEvent #${cat.replace(/\s/g, '')} #LocalEvent`,
        ],
        tip: [
          `Pro Tip from ${biz}!\n\nDid you know? Regular maintenance of your ${cat} can save you up to 30% on costly repairs down the road.\n\nHere are 3 things you can do today:\n1. Schedule a routine inspection\n2. Don't ignore small issues — they grow!\n3. Ask a professional for a maintenance plan\n\nNeed expert help? ${biz} is just a call away! We've been helping local homeowners and businesses for years.\n\n#ProTips #${cat.replace(/\s/g, '')} #LocalExpert`,
        ],
      };

      const options = posts[postType] || posts.promotion;
      setPost(options[Math.floor(Math.random() * options.length)]);
      setGenerating(false);
    }, 1000);
  };

  const copyPost = () => {
    navigator.clipboard.writeText(post);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <h2 className="text-lg font-bold text-base-content flex items-center gap-2"><PenTool size={18} className="text-warning" /> AI Post Creator</h2>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Business Name</label>
              <input className="input input-bordered input-sm w-full" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Superior Plumbing Co" />
            </div>
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Business Category</label>
              <input className="input input-bordered input-sm w-full" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Plumbing, Dental, etc." />
            </div>
          </div>

          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Platform</label>
              <div className="flex gap-1">
                {['gbp', 'facebook', 'yelp'].map(p => (
                  <button key={p} className={`btn btn-sm ${platform === p ? 'btn-primary' : 'btn-ghost border border-base-300'}`} onClick={() => setPlatform(p)}>
                    {p === 'gbp' ? <Globe size={13} /> : p === 'facebook' ? <Facebook size={13} /> : <Hash size={13} />}
                    {platformLabels[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Post Type</label>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(typeLabels).map(([key, label]) => (
                <button key={key} className={`btn btn-sm ${postType === key ? 'btn-secondary' : 'btn-ghost border border-base-300'}`} onClick={() => setPostType(key)}>{label}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Additional Topic/Details (optional)</label>
            <input className="input input-bordered input-sm w-full" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Spring cleaning special, new team member..." />
          </div>

          <button className="btn btn-primary btn-sm" onClick={generate} disabled={!businessName || generating}>
            {generating ? <span className="loading loading-spinner loading-sm" /> : <><Sparkles size={13} /> Generate Post</>}
          </button>
        </div>
      </div>

      {post && (
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-base-content text-sm">Generated Post — {platformLabels[platform]}</h3>
              <div className="flex gap-1">
                <button className="btn btn-ghost btn-xs" onClick={generate}><RefreshCw size={13} /></button>
                <button className="btn btn-ghost btn-xs" onClick={copyPost}>
                  {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
            </div>
            <div className="p-4 bg-base-200 rounded border border-base-300 text-sm text-base-content whitespace-pre-wrap">{post}</div>
            <p className="text-[10px] text-base-content/30 mt-2 font-mono">Character count: {post.length} | Best for {platformLabels[platform]}</p>
          </div>
        </div>
      )}
    </div>
  );
};
