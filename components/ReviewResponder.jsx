import React, { useState } from 'react';
import { MessageSquare, Sparkles, Copy, Check, Star, ThumbsUp, ThumbsDown, RefreshCw } from 'lucide-react';

export const ReviewResponder = () => {
  const [review, setReview] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [reviewType, setReviewType] = useState('positive');
  const [stars, setStars] = useState(5);
  const [response, setResponse] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tone, setTone] = useState('professional');

  const generateResponse = () => {
    if (!review) return;
    setGenerating(true);

    setTimeout(() => {
      const biz = businessName || 'our business';
      if (reviewType === 'positive') {
        const responses = [
          `Thank you so much for this wonderful ${stars}-star review! We're thrilled to hear about your experience at ${biz}. Our team works hard to deliver excellent service, and reviews like yours make it all worthwhile. We look forward to serving you again soon!`,
          `Wow, thank you for the kind words! Your feedback means the world to our team at ${biz}. We're so glad we could exceed your expectations. Please don't hesitate to reach out if you ever need anything — we're always here to help!`,
          `We're absolutely delighted by your review! At ${biz}, customer satisfaction is our top priority, and hearing that we hit the mark makes our day. Thank you for trusting us, and we can't wait to welcome you back!`,
        ];
        setResponse(responses[Math.floor(Math.random() * responses.length)]);
      } else {
        const responses = [
          `Thank you for taking the time to share your experience. We're truly sorry to hear that your visit to ${biz} didn't meet your expectations. Your feedback is valuable, and we'd like to make this right. Please reach out to us directly at [email/phone] so we can address your concerns personally. We appreciate another chance to earn your trust.`,
          `We sincerely apologize for the experience you described. At ${biz}, we hold ourselves to a high standard, and clearly we fell short this time. We've shared your feedback with our team and are taking steps to ensure this doesn't happen again. We'd love the opportunity to make it up to you — please contact us at [email/phone].`,
          `Thank you for your honest feedback. We're disappointed to hear about your experience at ${biz} and we take your concerns very seriously. This isn't the level of service we aim to provide. We've already begun reviewing what happened and would appreciate the chance to speak with you directly. Please reach out to us at [email/phone].`,
        ];
        setResponse(responses[Math.floor(Math.random() * responses.length)]);
      }
      setGenerating(false);
    }, 1000);
  };

  const copyResponse = () => {
    navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sampleReviews = [
    { text: 'Great service! The team was professional and finished the job ahead of schedule. Highly recommend!', type: 'positive', stars: 5 },
    { text: 'Terrible experience. Waited 2 hours past my appointment time and the staff was rude. Will not return.', type: 'negative', stars: 1 },
    { text: 'Good work overall but the pricing was higher than quoted. Communication could be better.', type: 'negative', stars: 3 },
    { text: 'Absolutely amazing! Best service I\'ve ever received. The owner personally made sure everything was perfect.', type: 'positive', stars: 5 },
  ];

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <h2 className="text-lg font-bold text-base-content flex items-center gap-2"><MessageSquare size={18} className="text-base-content/60" /> AI Review Responder</h2>

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Business Name (optional)</label>
            <input className="input input-bordered input-sm w-full" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Joe's Plumbing" />
          </div>

          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Review Type</label>
              <div className="flex gap-1">
                <button className={`btn btn-sm ${reviewType === 'positive' ? 'btn-success' : 'btn-ghost border border-base-300'}`} onClick={() => setReviewType('positive')}><ThumbsUp size={13} /> Positive</button>
                <button className={`btn btn-sm ${reviewType === 'negative' ? 'btn-error' : 'btn-ghost border border-base-300'}`} onClick={() => setReviewType('negative')}><ThumbsDown size={13} /> Negative</button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Stars</label>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} onClick={() => setStars(s)}>
                    <Star size={18} className={s <= stars ? 'text-warning' : 'text-base-300'} fill={s <= stars ? 'currentColor' : 'none'} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Tone</label>
              <select className="select select-bordered select-sm" value={tone} onChange={e => setTone(e.target.value)}>
                <option value="professional">Professional</option>
                <option value="warm">Warm & Friendly</option>
                <option value="empathetic">Empathetic</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Paste Review Here</label>
            <textarea className="textarea textarea-bordered w-full h-24" value={review} onChange={e => setReview(e.target.value)} placeholder="Paste the Google/Yelp review here..." />
          </div>

          <button className="btn btn-primary btn-sm w-full sm:w-auto" onClick={generateResponse} disabled={!review || generating}>
            {generating ? <span className="loading loading-spinner loading-sm" /> : <><Sparkles size={13} /> Generate Response</>}
          </button>
        </div>
      </div>

      {response && (
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-base-content text-sm">Generated Response</h3>
              <div className="flex gap-1">
                <button className="btn btn-ghost btn-xs" onClick={generateResponse}><RefreshCw size={13} /> Regenerate</button>
                <button className="btn btn-ghost btn-xs" onClick={copyResponse}>
                  {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
                </button>
              </div>
            </div>
            <div className="p-3 bg-base-200 rounded border border-base-300 text-sm text-base-content whitespace-pre-wrap">{response}</div>
          </div>
        </div>
      )}

      <div className="border border-base-300 rounded bg-base-100">
        <div className="p-4">
          <h3 className="font-semibold text-base-content mb-3 text-sm">Try Sample Reviews</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sampleReviews.map((sr, i) => (
              <div key={i} className="p-3 border border-base-200 rounded cursor-pointer hover:border-base-300 transition-colors" onClick={() => { setReview(sr.text); setReviewType(sr.type); setStars(sr.stars); }}>
                <div className="flex items-center gap-1 mb-1">
                  {Array.from({ length: 5 }, (_, s) => (
                    <Star key={s} size={11} className={s < sr.stars ? 'text-warning' : 'text-base-300'} fill={s < sr.stars ? 'currentColor' : 'none'} />
                  ))}
                </div>
                <p className="text-xs text-base-content/60 line-clamp-2">{sr.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
