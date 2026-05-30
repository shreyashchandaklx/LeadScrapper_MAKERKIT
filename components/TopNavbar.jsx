import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Zap, Globe, HelpCircle, ExternalLink, LogOut } from 'lucide-react';

const SERVICES = [
  { label: 'Map2Web',     href: 'https://app.pixnom.com/home/map2web/home' },
  { label: 'LeadScrapper', href: 'https://app.pixnom.com/home/leadscrapper/dashboard' },
  { label: 'Uptime',      href: 'https://app.pixnom.com/home/uptime' },
];

const BILLING_URL  = 'https://app.pixnom.com/home/billing';
const CREDITS_MAX  = 1000; // visual cap for the orange bar; bar fills proportionally up to this

function useOutsideClick(ref, onClose) {
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

function Dropdown({ trigger, children, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useOutsideClick(ref, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-sm text-base-content/80 hover:text-base-content px-2 py-1.5 rounded transition-colors"
      >
        {trigger}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute z-50 mt-1 min-w-[200px] bg-base-100 border border-base-300 rounded shadow-lg py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

export default function TopNavbar({ balance, userEmail, onLogout }) {
  const credits = typeof balance === 'number' ? Math.floor(balance) : null;
  const pct = credits === null ? 0 : Math.min(100, Math.max(4, (credits / CREDITS_MAX) * 100));
  const initial = (userEmail || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <header className="w-full bg-base-100 border-b border-base-300 px-4 h-14 flex items-center gap-4 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 pr-2">
        <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
          <Zap size={14} className="text-primary-content" />
        </div>
        <span className="font-semibold text-base-content text-sm" style={{ fontFamily: "'Inter',sans-serif" }}>
          Leadscrapper
        </span>
      </div>

      {/* Services dropdown */}
      <Dropdown trigger={<span>Services</span>}>
        {SERVICES.map(s => (
          <a
            key={s.label}
            href={s.href}
            target="_top"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-3 py-2 text-sm text-base-content/80 hover:bg-base-200 hover:text-base-content"
          >
            <span>{s.label}</span>
            <ExternalLink className="w-3 h-3 text-base-content/30" />
          </a>
        ))}
      </Dropdown>

      {/* Billing */}
      <a
        href={BILLING_URL}
        target="_top"
        rel="noopener noreferrer"
        className="text-sm text-base-content/80 hover:text-base-content px-2 py-1.5 rounded transition-colors"
      >
        Billing
      </a>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Credits bar + Upgrade */}
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-2">
          <div className="w-24 h-1.5 rounded-full bg-base-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs text-base-content/70 whitespace-nowrap">
            {credits === null ? '… Credits left' : `${credits.toLocaleString()} Credits left`}
          </span>
        </div>
        <a
          href={BILLING_URL}
          target="_top"
          rel="noopener noreferrer"
          className="btn btn-sm btn-primary h-8 min-h-0 px-3 text-xs font-medium"
        >
          Upgrade
        </a>
      </div>

      {/* Need Help? */}
      <Dropdown
        align="right"
        trigger={
          <span className="flex items-center gap-1.5 text-primary">
            <HelpCircle className="w-4 h-4" /> Need Help?
          </span>
        }
      >
        <a
          href="mailto:support@pixnom.com"
          className="block px-3 py-2 text-sm text-base-content/80 hover:bg-base-200"
        >
          Contact Support
        </a>
        <a
          href={BILLING_URL}
          target="_top"
          rel="noopener noreferrer"
          className="block px-3 py-2 text-sm text-base-content/80 hover:bg-base-200"
        >
          Billing &amp; Plans
        </a>
      </Dropdown>

      {/* Language */}
      <div className="hidden sm:flex items-center gap-1 text-sm text-base-content/60">
        <Globe className="w-4 h-4" />
        <span>EN</span>
      </div>

      {/* Avatar dropdown */}
      <Dropdown
        align="right"
        trigger={
          <div className="w-8 h-8 rounded-full bg-base-200 border border-base-300 flex items-center justify-center text-sm font-semibold text-base-content/70">
            {initial}
          </div>
        }
      >
        {({ close }) => (
          <>
            {userEmail && (
              <div className="px-3 py-2 text-xs text-base-content/50 border-b border-base-200 truncate max-w-[240px]">
                {userEmail}
              </div>
            )}
            <a
              href={BILLING_URL}
              target="_top"
              rel="noopener noreferrer"
              className="block px-3 py-2 text-sm text-base-content/80 hover:bg-base-200"
            >
              Billing
            </a>
            {typeof onLogout === 'function' && (
              <button
                type="button"
                onClick={() => { close(); onLogout(); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-error/80 hover:bg-error/5 hover:text-error"
              >
                <LogOut className="w-3.5 h-3.5" /> Log Out
              </button>
            )}
          </>
        )}
      </Dropdown>
    </header>
  );
}
