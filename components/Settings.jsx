import React, { useState } from 'react';
import { Settings as SettingsIcon, User, CreditCard, Bell, Check, Zap } from 'lucide-react';
import { subscriptionPlans } from '../utils/mockData.js';

export const Settings = () => {
  const [tab, setTab] = useState('profile');
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState({ name: 'Shreyash', email: 'user@example.com', company: 'Digital Agency Pro', phone: '' });

  const [currentPlan, setCurrentPlan] = useState('Pro');

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: <User size={14} /> },
    { id: 'billing', label: 'Billing', icon: <CreditCard size={14} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  ];

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <h2 className="text-lg font-bold text-base-content flex items-center gap-2"><SettingsIcon size={18} /> Settings</h2>

      <div className="flex gap-1 border border-base-300 rounded bg-base-100 p-1 flex-wrap w-fit">
        {tabs.map(t => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Profile Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Full Name</label>
                <input className="input input-bordered input-sm w-full" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Email</label>
                <input className="input input-bordered input-sm w-full" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Company</label>
                <input className="input input-bordered input-sm w-full" value={profile.company} onChange={e => setProfile({ ...profile, company: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-base-content/50 mb-1 block uppercase tracking-wider" style={{fontFamily:"'Inter',sans-serif"}}>Phone</label>
                <input className="input input-bordered input-sm w-full" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} placeholder="(555) 123-4567" />
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={save}>{saved ? <><Check size={13} /> Saved!</> : 'Save Changes'}</button>
          </div>
        </div>
      )}

      {tab === 'billing' && (
        <div className="space-y-4">
          <div className="border border-base-300 rounded bg-base-100">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">Current Plan: <span className="text-base-content">{currentPlan}</span></h3>
                  <p className="text-xs text-base-content/40 font-mono">Renews April 23, 2026</p>
                </div>
                <Zap size={20} className="text-base-content/30" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {subscriptionPlans.map(plan => (
              <div key={plan.name} className={`border rounded bg-base-100 ${plan.popular ? 'border-primary' : 'border-base-300'}`}>
                <div className="p-4">
                  {plan.popular && <span className="badge badge-primary badge-sm mb-2">Most Popular</span>}
                  <h3 className="text-lg font-bold text-base-content">{plan.name}</h3>
                  <p className="text-2xl font-bold text-base-content mt-1" style={{fontFamily:"'Inter',sans-serif"}}>{plan.price}<span className="text-sm text-base-content/40 font-normal">{plan.billing}</span></p>
                  <p className="text-[10px] text-base-content/40 font-mono mt-1">{plan.leads_per_month.toLocaleString()} leads/mo &middot; {plan.reports_per_month} reports/mo</p>
                  <ul className="space-y-1 mt-3">
                    {plan.features.map(f => (
                      <li key={f} className="text-xs flex items-center gap-1.5">
                        <Check size={11} className="text-success flex-shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                  <button className={`btn btn-sm mt-3 w-full ${currentPlan === plan.name ? 'btn-disabled' : plan.popular ? 'btn-primary' : 'btn-ghost border border-base-300'}`}>
                    {currentPlan === plan.name ? 'Current Plan' : 'Upgrade'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="border border-base-300 rounded bg-base-100">
          <div className="p-4 space-y-3">
            <h3 className="font-semibold text-sm">Notification Preferences</h3>
            {[
              { label: 'Email when a lead replies', defaultChecked: true },
              { label: 'Weekly lead digest', defaultChecked: true },
              { label: 'Report generation complete', defaultChecked: true },
              { label: 'New feature announcements', defaultChecked: false },
              { label: 'Subscription renewal reminders', defaultChecked: true },
            ].map(n => (
              <label key={n.label} className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="toggle toggle-primary toggle-sm" defaultChecked={n.defaultChecked} />
                <span className="text-sm text-base-content">{n.label}</span>
              </label>
            ))}
            <button className="btn btn-primary btn-sm" onClick={save}>{saved ? <><Check size={13} /> Saved!</> : 'Save Preferences'}</button>
          </div>
        </div>
      )}
    </div>
  );
};
