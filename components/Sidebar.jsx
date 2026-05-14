import React from 'react';
import { LayoutDashboard, Search, Users, Mail, FileText, MessageSquare, PenTool, Send, Settings, Zap, ChevronLeft, ChevronRight, LogOut } from 'lucide-react';

const navItems = [
  { page: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { page: 'search', label: 'Find Leads', icon: <Search size={18} /> },
  { page: 'leads', label: 'Lead Manager', icon: <Users size={18} /> },
  { page: 'email-gen', label: 'AI Email Writer', icon: <Mail size={18} /> },
  { page: 'reports', label: 'PDF Reports', icon: <FileText size={18} /> },
  { page: 'review', label: 'Review Responder', icon: <MessageSquare size={18} /> },
  { page: 'posts', label: 'Post Creator', icon: <PenTool size={18} /> },
  { page: 'outreach', label: 'Email Outreach', icon: <Send size={18} /> },
  { page: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

export const Sidebar = ({ currentPage, onNavigate, collapsed, onToggleCollapse, onLogout }) => {
  return (
    <div className={`bg-base-100 h-full flex flex-col border-r border-base-300 transition-all duration-200 ${collapsed ? 'w-14' : 'w-56'}`}>
      {/* Logo */}
      <div
        onClick={() => onNavigate('dashboard')}
        className="p-3 flex items-center gap-2.5 border-b border-base-300 cursor-pointer hover:bg-base-200 transition-colors"
      >
        <div className="w-7 h-7 rounded bg-primary flex items-center justify-center flex-shrink-0">
          <Zap size={14} className="text-primary-content" />
        </div>
        {!collapsed && <span className="font-semibold text-base-content text-sm" style={{fontFamily:"'Inter',sans-serif"}}>Leadscrapper</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-1.5 space-y-0.5 overflow-y-auto">
        {navItems.map(item => (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-colors ${
              currentPage === item.page
                ? 'bg-primary text-primary-content font-medium'
                : 'text-base-content/60 hover:bg-base-200 hover:text-base-content'
            }`}
            title={collapsed ? item.label : undefined}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Logout */}
      {onLogout && (
        <button
          onClick={onLogout}
          className="mx-1.5 mb-1.5 flex items-center gap-2.5 px-2.5 py-2 rounded text-sm text-error/60 hover:bg-error/5 hover:text-error transition-colors"
          title={collapsed ? 'Log Out' : undefined}
        >
          <span className="flex-shrink-0"><LogOut size={18} /></span>
          {!collapsed && <span>Log Out</span>}
        </button>
      )}

      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className="p-2.5 border-t border-base-300 flex items-center justify-center text-base-content/40 hover:text-base-content transition-colors"
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </div>
  );
};
