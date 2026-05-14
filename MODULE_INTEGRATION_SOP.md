# 📘 Module Integration SOP — Pixnom SaaS Platform

> **What is this?** A step-by-step guide for integrating any standalone web app (module) into the Makerkit-based SaaS dashboard at `app.pixnom.com`. Written so anyone can follow it.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              app.pixnom.com (Makerkit)               │
│  ┌───────────┐  ┌─────────────────────────────────┐ │
│  │  Sidebar   │  │  Content Area (iframe)          │ │
│  │           │  │                                  │ │
│  │ Map2Web  ▸│  │  Loads the standalone app from   │ │
│  │ Leadscrp ▸│  │  its own subdomain, e.g.         │ │
│  │ NewModule▸│  │  newmodule.pixnom.com?embed=true │ │
│  │           │  │                                  │ │
│  └───────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         │                        │
         │ Next.js (port 3000)    │ iframe loads from
         │ served by pm2          │ Nginx (port 80/443)
         ▼                        ▼
              Linux VPS: 74.208.208.186
```

**Key Concept:** We do NOT rewrite modules inside Makerkit. We embed them via `<iframe>` with `?embed=true` so the standalone app hides its own sidebar/login and feels native.

---

## 📂 File Structure on Linux VPS

```
/root/next-supabase-saas-kit-turbo-main/        ← Makerkit monorepo
  └── apps/web/
      ├── app/[locale]/home/(user)/
      │   ├── map2web/                          ← Map2Web module
      │   ├── leadscrapper/                     ← Leadscrapper module
      │   │   ├── _components/
      │   │   │   └── LeadscrapperFrame.tsx     ← Shared iframe wrapper
      │   │   ├── find-leads/page.tsx
      │   │   ├── lead-manager/page.tsx
      │   │   └── ... (one folder per sub-page)
      │   └── YOUR-NEW-MODULE/                  ← ⭐ You create this
      └── config/
          └── personal-account-navigation.config.tsx  ← Sidebar links

/var/www/
├── leadscrapper.pixnom.com/                    ← Standalone Leadscrapper
│   ├── index.html
│   ├── assets/            ← JS/CSS bundles
│   └── .env
└── YOUR-NEW-MODULE.pixnom.com/                 ← ⭐ You create this

/etc/nginx/sites-available/
├── leadscrapper           ← Nginx config per module
└── YOUR-NEW-MODULE        ← ⭐ You create this
```

---

## 🚀 Step-by-Step: Integrate a New Module

### Prerequisites

| You need | Where to get it |
|---|---|
| SSH access to VPS | `ssh root@74.208.208.186` |
| WinSCP (file transfer) | winscp.net |
| Domain DNS access | MilesWeb → DNS Zone Editor |
| Standalone app source code | Your local Windows machine |

---

### STEP 1: Prepare the Standalone App for Embed Mode

Your standalone app needs these changes to work inside an iframe:

#### 1A. Detect embed mode in `index.html`

Add this script **before** any login/captcha logic:

```html
<script>
  var isEmbedMode = new URLSearchParams(window.location.search).get('embed') === 'true';
  window.__EMBED_MODE__ = isEmbedMode;
</script>
```

#### 1B. Skip login/captcha gates in embed mode

```javascript
if (isEmbedMode) {
  document.getElementById('captcha-page').style.display = 'none';
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('root').style.display = 'block';
  return;
}
```

#### 1C. Hide the app's own sidebar

```jsx
const isEmbed = window.__EMBED_MODE__ === true;
return (
  <div className="flex">
    {!isEmbed && <Sidebar />}
    <main>{/* page content */}</main>
  </div>
);
```

#### 1D. Support `?page=` routing from URL

```javascript
const getInitialPage = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('page') || 'default-page';
};
const [page, setPage] = useState(getInitialPage);
```

#### 1E. Build the app

```bash
npm run build
```

---

### STEP 2: Set Up DNS (MilesWeb)

1. Log in to **MilesWeb Client Area**
2. Go to **Domains** → **DNS Zone Editor**
3. Select `pixnom.com`
4. Click **Add Record**:
   - **Type:** A
   - **Name:** `your-module-name` (e.g., `newmodule`)
   - **Value:** `74.208.208.186`
   - **TTL:** 1 minute
5. Click **Save**

> ⏱️ DNS takes 5–30 minutes to propagate.

---

### STEP 3: Upload Files to VPS

#### 3A. Create directory on VPS

```bash
ssh root@74.208.208.186
mkdir -p /var/www/newmodule.pixnom.com
```

#### 3B. Upload via WinSCP

1. Open WinSCP → connect to `74.208.208.186`
2. **Left side (local):** Navigate to your app's `dist/` folder
3. **Right side (VPS):** Navigate to `/var/www/newmodule.pixnom.com/`
4. Select all → drag to right → click **"Yes to All"** to overwrite

---

### STEP 4: Configure Nginx + SSL

#### 4A. Create Nginx config

```bash
cat << 'EOF' | sudo tee /etc/nginx/sites-available/newmodule
server {
    listen 80;
    server_name newmodule.pixnom.com;
    root /var/www/newmodule.pixnom.com;
    index index.html index.php;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Only if your app uses PHP files:
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
    }
}
EOF
```

> ⚠️ Check your PHP version with `php -v` and adjust `php8.1` accordingly.

#### 4B. Enable and restart

```bash
sudo ln -s /etc/nginx/sites-available/newmodule /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 4C. Generate SSL

```bash
sudo certbot --nginx -d newmodule.pixnom.com --non-interactive --agree-tos -m admin@pixnom.com
```

#### 4D. Verify

Open `https://newmodule.pixnom.com?embed=true` in browser — should work without sidebar/login.

---

### STEP 5: Create Makerkit Pages

#### 5A. Create iframe wrapper: `_components/ModuleFrame.tsx`

```tsx
'use client';

interface Props {
  page?: string;
  title: string;
}

export default function ModuleFrame({ page, title }: Props) {
  const params = new URLSearchParams({ embed: 'true' });
  if (page) params.set('page', page);
  const src = `https://newmodule.pixnom.com?${params.toString()}`;

  return (
    <div className="h-[calc(100vh-4rem)]">
      <iframe src={src} className="h-full w-full border-0" title={title} />
    </div>
  );
}
```

#### 5B. Create one `page.tsx` per sub-page

```tsx
import ModuleFrame from '../_components/ModuleFrame';
export const metadata = { title: 'NewModule — Dashboard' };

export default function DashboardPage() {
  return <ModuleFrame page="dashboard" title="Dashboard" />;
}
```

Repeat for each sub-page, changing the `page` prop.

#### 5C. Upload to VPS

Upload your folder to:
```
/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/newmodule/
```

---

### STEP 6: Add Sidebar Navigation

Edit on VPS:
```bash
nano /root/next-supabase-saas-kit-turbo-main/apps/web/config/personal-account-navigation.config.tsx
```

Add your entry:
```tsx
{
  label: 'New Module',
  collapsible: true,
  collapsed: true,
  children: [
    { label: 'Dashboard',   path: '/home/newmodule/dashboard' },
    { label: 'Feature One', path: '/home/newmodule/feature-one' },
    { label: 'Settings',    path: '/home/newmodule/settings' },
  ],
},
```

---

### STEP 7: Build & Deploy

```bash
cd /root/next-supabase-saas-kit-turbo-main
pnpm build && pm2 restart makerkit
```

---

## 🔧 Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Blank white iframe | No SSL certificate | Run `certbot` (Step 4C) |
| Cloudflare challenge in iframe | DNS proxied (orange cloud) | Set to "DNS Only" (gray cloud) |
| Double sidebar | `?embed=true` not working | Check `index.html` embed detection |
| `Module not found` build error | Bad import in `.tsx` file | Only use packages in the monorepo |
| Old version showing | Browser cache | `Ctrl+Shift+R` + re-upload dist |
| PHP files return 404 | Missing PHP-FPM block | Add `location ~ \.php$` in Nginx |

---

## 📋 Commands Cheat Sheet

```bash
# SSH in
ssh root@74.208.208.186

# Create module directory
mkdir -p /var/www/MODULENAME.pixnom.com

# Nginx setup
sudo nano /etc/nginx/sites-available/MODULENAME
sudo ln -s /etc/nginx/sites-available/MODULENAME /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# SSL
sudo certbot --nginx -d MODULENAME.pixnom.com --non-interactive --agree-tos -m admin@pixnom.com

# Edit sidebar
nano /root/next-supabase-saas-kit-turbo-main/apps/web/config/personal-account-navigation.config.tsx

# Build & restart
cd /root/next-supabase-saas-kit-turbo-main && pnpm build && pm2 restart makerkit

# Debug
pm2 logs makerkit --lines 50
tail -50 /var/log/nginx/error.log
```

---

## ✅ Integration Checklist

- [ ] Standalone app has `?embed=true` detection
- [ ] Sidebar hidden when `__EMBED_MODE__` is true
- [ ] Login/captcha bypassed in embed mode
- [ ] `?page=` URL routing supported
- [ ] App built (`npm run build`)
- [ ] DNS A record created at MilesWeb → `74.208.208.186`
- [ ] `dist/` uploaded to `/var/www/MODULENAME.pixnom.com/`
- [ ] Nginx config created + enabled
- [ ] SSL generated via Certbot
- [ ] `https://MODULENAME.pixnom.com?embed=true` works in browser
- [ ] `ModuleFrame.tsx` created with correct subdomain
- [ ] One `page.tsx` per sub-page
- [ ] Pages uploaded to VPS Makerkit directory
- [ ] Sidebar entry added to nav config
- [ ] `pnpm build && pm2 restart makerkit` successful
- [ ] All sidebar links load correctly

---

*Last updated: 12 May 2026*
