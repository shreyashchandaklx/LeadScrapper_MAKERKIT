'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';


const SERVICES = [
  { label: 'Map2Web', href: '/home/map2web/home' },
  { label: 'LeadScrapper', href: '/home/leadscrapper/dashboard' },
  { label: 'Uptime', href: '/home/uptime' },
];

export function ServicesDropdown() {
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
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground px-2 py-1.5 rounded transition-colors"
      >
        Services
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[180px] bg-popover border border-border rounded-md shadow-md py-1 left-0">
          {SERVICES.map(s => (
            <Link
              key={s.label}
              href={s.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
