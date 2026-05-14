# Deploy: Leadscrapper dropdown into app.pixnom.com

## What this folder contains

A drop-in `leadscrapper/` route group for the Makerkit app. Each sub-page renders
`LeadscrapperFrame`, which iframes `https://leadscrapper.pixnom.com` with
`?embed=true&page=<slug>` so the standalone app can hide its own chrome and
deep-link to the right view.

```
makerkit-leadscrapper/
├── layout.tsx                          passthrough
├── page.tsx                            redirect → /home/leadscrapper/find-leads
├── _components/
│   └── LeadscrapperFrame.tsx           iframe wrapper (embed=true + page=slug)
├── dashboard/page.tsx                  page=dashboard
├── find-leads/page.tsx                 (no page slug — landing view)
├── lead-manager/page.tsx               page=leads
├── ai-email-writer/page.tsx            page=email-gen
├── pdf-reports/page.tsx                page=reports
├── review-responder/page.tsx           page=review-responder
├── post-creator/page.tsx               page=post-creator
├── email-outreach/page.tsx             page=email-outreach
└── settings/page.tsx                   page=settings
```

## Step 1 — Upload via WinSCP

Drag this entire folder into:

```
/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/leadscrapper/
```

(Rename the upload from `makerkit-leadscrapper` → `leadscrapper` on the VPS.)

## Step 2 — Edit the main nav config

File: `/root/next-supabase-saas-kit-turbo-main/apps/web/config/personal-account-navigation.config.tsx`

Replace the existing single Leadscrapper entry with a collapsible group of 9
children. Use the same shape as the Map2Web group (search the file for
`map2web` to find the working example). Pattern:

```tsx
{
  label: 'Leadscrapper',
  Icon: <Search className="h-4 w-4" />,
  collapsible: true,
  children: [
    { label: 'Dashboard',        path: '/home/leadscrapper/dashboard',        Icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Find Leads',       path: '/home/leadscrapper/find-leads',       Icon: <Search className="h-4 w-4" /> },
    { label: 'Lead Manager',     path: '/home/leadscrapper/lead-manager',     Icon: <Users className="h-4 w-4" /> },
    { label: 'AI Email Writer',  path: '/home/leadscrapper/ai-email-writer',  Icon: <Mail className="h-4 w-4" /> },
    { label: 'PDF Reports',      path: '/home/leadscrapper/pdf-reports',      Icon: <FileText className="h-4 w-4" /> },
    { label: 'Review Responder', path: '/home/leadscrapper/review-responder', Icon: <MessageSquare className="h-4 w-4" /> },
    { label: 'Post Creator',     path: '/home/leadscrapper/post-creator',     Icon: <Megaphone className="h-4 w-4" /> },
    { label: 'Email Outreach',   path: '/home/leadscrapper/email-outreach',   Icon: <Send className="h-4 w-4" /> },
    { label: 'Settings',         path: '/home/leadscrapper/settings',         Icon: <Settings className="h-4 w-4" /> },
  ],
}
```

Make sure all icon names are in the `lucide-react` import at the top of the
file (LayoutDashboard, Search, Users, Mail, FileText, MessageSquare, Megaphone,
Send, Settings). The previous `Search` import added last session stays.

## Step 3 — Standalone app must honor `?embed=true&page=<slug>`

The iframe sends these query params. The standalone `leadscrapper.pixnom.com`
needs to:

1. When `embed=true`, hide its own top nav / header / footer (just show the
   feature panel).
2. When `page=<slug>` is present, route to that view on load. Slugs in use:
   `dashboard`, `leads`, `email-gen`, `reports`, `review-responder`,
   `post-creator`, `email-outreach`, `settings`. The `find-leads/page.tsx`
   doesn't pass a slug, so the standalone's default view should be the
   scraper.

Until the standalone is updated, the iframe will just show the full standalone
UI inside the Makerkit shell — functional, but with two layers of chrome.

## Step 4 — Rebuild and restart

```bash
cd /root/next-supabase-saas-kit-turbo-main
pnpm build
pm2 restart web
```

If build fails on a missing lucide icon import, add it to
`personal-account-navigation.config.tsx`.

## Step 5 — Verify

1. `https://app.pixnom.com/home/leadscrapper/find-leads` loads with iframe.
2. Main sidebar shows "Leadscrapper" as a collapsible group; clicking any
   child routes to the right page.
3. Each sub-page iframe loads with its `page=<slug>` param visible in the
   iframe URL (DevTools → Network).
4. Cache still works in the iframe: search "plumbers + denver, 30" twice;
   second run is instant.
