import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

export default function SearchableDropdown({
  label,
  icon: Icon,
  placeholder = 'Select...',
  options = [],
  value,
  onChange,
  disabled = false,
  searchPlaceholder = 'Type to search...'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options.filter(opt => opt.toLowerCase().includes(q));
  }, [options, search]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSelect = (opt) => {
    onChange(opt);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setSearch('');
  };

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="block text-sm text-base-content/50 mb-1">{label}</label>}

      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => { if (!disabled && options.length > 0) setIsOpen(!isOpen); }}
        className={`
          flex items-center w-full h-10 px-3 rounded border text-sm transition-all duration-200
          ${disabled || options.length === 0
            ? 'bg-base-200 border-base-300 text-base-content/30 cursor-not-allowed'
            : 'bg-base-100 border-base-300 hover:border-base-content/30 cursor-pointer'
          }
          ${isOpen ? 'border-primary ring-1 ring-primary/10' : ''}
        `}
      >
        {Icon && <Icon className="w-4 h-4 mr-2 text-base-content/30 flex-shrink-0" />}
        <span className={`flex-1 text-left truncate ${value ? 'text-base-content' : 'text-base-content/40'}`}>
          {value || placeholder}
        </span>
        {value && !disabled && (
          <X
            className="w-3.5 h-3.5 text-base-content/30 hover:text-error mr-1 flex-shrink-0 transition-colors"
            onClick={handleClear}
          />
        )}
        <ChevronDown className={`w-4 h-4 text-base-content/30 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-[60] mt-1 w-full bg-base-100 border border-base-300 rounded shadow-lg overflow-hidden"
          style={{ maxHeight: '320px' }}
        >
          {options.length > 5 && (
            <div className="p-2 border-b border-base-200 sticky top-0 bg-base-100 z-10">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-base-content/30" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="input input-bordered input-sm w-full pl-8 h-8 text-sm bg-base-200/50 focus:bg-base-100"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-3 h-3 text-base-content/30 hover:text-error" />
                  </button>
                )}
              </div>
              <div className="text-[10px] text-base-content/30 mt-1 px-1 font-mono">
                {filtered.length} of {options.length} items
              </div>
            </div>
          )}

          <div className="overflow-y-auto" style={{ maxHeight: options.length > 5 ? '230px' : '260px' }}>
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-base-content/40">
                No results for "{search}"
              </div>
            ) : (
              filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => handleSelect(opt)}
                  className={`
                    w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors duration-100
                    ${opt === value
                      ? 'bg-primary/5 text-primary font-medium'
                      : 'text-base-content hover:bg-base-200/70'
                    }
                  `}
                >
                  {opt === value && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                  <span className={opt === value ? '' : 'ml-5.5'}>{opt}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
