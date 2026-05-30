'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Headphones, Mail, Phone } from 'lucide-react';

const CONTACT_URL = 'https://pixnom.com/contact.html';
const PHONE_DISPLAY = '+91 92725 23103';
const PHONE_TEL = '+919272523103';

export function NeedHelpDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        <Headphones className="w-3.5 h-3.5" />
        Need Help?
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 right-0 min-w-[220px] bg-popover border border-border rounded-md shadow-md py-1">
          <a
            href={CONTACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Mail className="w-4 h-4 text-muted-foreground" />
            Contact Us
          </a>
          <a
            href={`tel:${PHONE_TEL}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Phone className="w-4 h-4 text-muted-foreground" />
            <span> {PHONE_DISPLAY}</span>
          </a>
        </div>
      )}
    </div>
  );
}
