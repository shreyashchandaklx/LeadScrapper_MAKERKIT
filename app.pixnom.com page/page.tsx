import Link from 'next/link';

import {
  ArrowRightIcon,
  CheckIcon,
  Star,
  Bot,
  Sparkles,
  Camera,
  ShieldCheck,
  Leaf,
  UtensilsCrossed,
  Wind,
  PaintBucket,
  Truck,
  Zap,
  Globe,
  Activity,
  Search,
  BarChart3,
  TrendingUp,
  Users,
  Shield,
  Clock,
  ArrowUpRight,
  Cpu,
  Eye,
  Mail,
  Bell,
  ArrowDown,
  ArrowUp,
  Wifi,
  Lock,
  MousePointerClick,
  PieChart,
  Target,
  Rocket,
} from 'lucide-react';

/* ─────────────────────────────────────────────
   Pixnom – SaaS Landing Page
   ───────────────────────────────────────────── */

const animationStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  :root {
    --orange: #f97316;
    --orange-hover: #ea580c;
    --dark: #0a0a0a;
    --muted: #71717a;
    --border: #e4e4e7;
  }

  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(30px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(249,115,22,0); }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
  }

  @keyframes gradient-x {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }

  @keyframes bar-grow {
    from { transform: scaleY(0); }
    to { transform: scaleY(1); }
  }

  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }

  @keyframes count-up {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes bounce-arrow {
    0%, 100% { transform: translateX(0) rotate(-20deg); }
    50% { transform: translateX(6px) rotate(-20deg); }
  }

  @keyframes donut-fill {
    from { stroke-dasharray: 0 100; }
    to { stroke-dasharray: var(--fill) 100; }
  }

  @keyframes slide-up-fade {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .animate-fade-in-up { animation: fadeInUp 0.6s ease-out forwards; }
  .animate-d1 { animation: fadeInUp 0.6s ease-out 0.1s forwards; opacity: 0; }
  .animate-d2 { animation: fadeInUp 0.6s ease-out 0.2s forwards; opacity: 0; }
  .animate-d3 { animation: fadeInUp 0.6s ease-out 0.3s forwards; opacity: 0; }
  .animate-d4 { animation: fadeInUp 0.6s ease-out 0.4s forwards; opacity: 0; }
  .animate-slide-right { animation: slideInRight 0.7s ease-out 0.3s forwards; opacity: 0; }
  .animate-float { animation: float 5s ease-in-out infinite; }

  .gradient-text {
    background: linear-gradient(135deg, #f97316 0%, #ea580c 50%, #f97316 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: gradient-x 3s ease infinite;
  }

  .shimmer-border { position: relative; overflow: hidden; }
  .shimmer-border::before {
    content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
    background: linear-gradient(135deg, transparent 30%, rgba(249,115,22,0.25) 50%, transparent 70%);
    background-size: 200% 200%; animation: shimmer 4s linear infinite;
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none;
  }

  .card-hover { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .card-hover:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(0,0,0,0.06), 0 0 0 1px rgba(249,115,22,0.08); }

  .btn-primary { position: relative; overflow: hidden; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 25px rgba(249,115,22,0.35); }
  .btn-primary::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%); opacity: 0; transition: opacity 0.3s; }
  .btn-primary:hover::after { opacity: 1; }

  .noise-bg { position: relative; }
  .noise-bg::before {
    content: ''; position: absolute; inset: 0; opacity: 0.03;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    pointer-events: none;
  }

  .feature-icon-box { transition: all 0.3s ease; }
  .feature-card:hover .feature-icon-box { background: #f97316; color: #fff; box-shadow: 0 6px 20px rgba(249,115,22,0.25); }

  .bar-animate { animation: bar-grow 0.8s ease-out forwards; transform-origin: bottom; }

  .search-input-glow:focus-within {
    box-shadow: 0 0 0 3px rgba(249,115,22,0.15), 0 8px 30px rgba(0,0,0,0.06);
    border-color: #f97316;
  }

  .stat-card { transition: all 0.3s ease; }
  .stat-card:hover { border-color: #f97316; box-shadow: 0 0 0 1px rgba(249,115,22,0.1), 0 8px 24px rgba(0,0,0,0.04); }

  .bounce-arrow { animation: bounce-arrow 1.2s ease-in-out infinite; }
  .donut-animate { animation: donut-fill 1.5s ease-out forwards; }
  .slide-up-stagger { animation: slide-up-fade 0.4s ease-out forwards; opacity: 0; }

  .showcase-card { transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
  .showcase-card:hover { transform: translateY(-4px); box-shadow: 0 20px 50px rgba(0,0,0,0.08); }
  .showcase-card:hover .showcase-badge { background: #f97316; color: #fff; border-color: #f97316; }

  .warm-cta-bg { background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fff7ed 100%); }
`;

function Home() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: animationStyles }} />

      <div className="bg-white text-[#0a0a0a]">
        {/* ═══════ ANNOUNCEMENT BAR ═══════ */}
        <div className="bg-[#0a0a0a] px-4 py-2.5 text-center text-sm font-medium text-white">
          <span className="mr-2 inline-flex items-center gap-1.5 rounded-full bg-[#f97316] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            New
          </span>
          Free Digital Audit for 10 Businesses This Month —{' '}
          <Link href="https://pixnom.com/book-appointment.html" className="font-bold text-[#f97316] underline underline-offset-2 transition hover:text-orange-300">
            Claim Yours →
          </Link>
        </div>

        {/* ═══════ HERO — SEARCH-DRIVEN ═══════ */}
        <section className="relative overflow-hidden px-6 pt-16 pb-10 md:pt-24 md:pb-14">
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, rgba(0,0,0,0.15) 1px, transparent 0)`,
              backgroundSize: '32px 32px',
            }}
          />
          <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-[#f97316] opacity-[0.04] blur-[120px]" />

          <div className="relative mx-auto max-w-4xl text-center">
            <div className="animate-fade-in-up mb-6 inline-flex items-center gap-2 rounded-full border border-[#e4e4e7] bg-white px-4 py-1.5 text-[13px] font-semibold text-[#0a0a0a] shadow-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-[#f97316]" style={{ animation: 'pulse-glow 2s ease-in-out infinite' }} />
              India&rsquo;s #1 Digital Growth Platform
            </div>

            <h1 className="animate-d1 text-4xl font-extrabold tracking-[-0.04em] text-[#0a0a0a] sm:text-5xl md:text-[56px] md:leading-[1.1]">
              Add your domain to start{' '}
              <span className="gradient-text">growing</span> your business
            </h1>

            <p className="animate-d2 mx-auto mt-5 max-w-2xl text-[16px] leading-[1.6] text-[#71717a]">
              Stop guessing. Get a free digital audit, build your website with AI,
              and monitor everything — all from one platform.
            </p>

            {/* ── SEARCH INPUT with START HERE arrow ── */}
            <div className="animate-d3 relative mx-auto mt-8 max-w-xl">
              {/* "START HERE!" annotation arrow */}
              <div className="absolute -left-28 top-1/2 hidden -translate-y-1/2 items-center gap-1 md:flex">
                <span className="text-[13px] font-bold uppercase tracking-wide text-[#f97316]">Start here!</span>
                <svg className="bounce-arrow h-6 w-8 text-[#f97316]" viewBox="0 0 32 24" fill="none">
                  <path d="M2 12C2 12 22 12 28 12M28 12L20 4M28 12L20 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <div className="search-input-glow flex items-center gap-2 rounded-2xl border border-[#e4e4e7] bg-white px-4 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300">
                <Search className="h-5 w-5 flex-shrink-0 text-[#a1a1aa]" />
                <input
                  type="text"
                  placeholder="Enter your website (e.g. yoursite.com)"
                  className="flex-1 bg-transparent py-2 text-[15px] text-[#0a0a0a] placeholder-[#a1a1aa] outline-none"
                />
                <Link href="/auth/sign-up" className="btn-primary flex-shrink-0 rounded-xl bg-[#f97316] px-5 py-2.5 text-sm font-semibold text-white">
                  Analyze
                </Link>
              </div>
              <p className="mt-3 text-[13px] text-[#a1a1aa]">
                No credit card required · Free audit in 60 seconds · 500+ businesses trust Pixnom
              </p>
            </div>
          </div>
        </section>

        {/* ═══════ KPI STAT CARDS ═══════ */}
        <section className="border-t border-[#f4f4f5] bg-[#fafafa] px-6 py-8">
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-4">
            <KPICard value="500+" label="Businesses Served" icon={<Users className="h-4 w-4" />} />
            <KPICard value="4.9" label="Average Rating" icon={<Star className="h-4 w-4 fill-[#f97316] text-[#f97316]" />} />
            <KPICard value="30 days" label="Avg. Time to Results" icon={<Clock className="h-4 w-4" />} />
            <KPICard value="99.9%" label="Uptime Guarantee" icon={<Shield className="h-4 w-4" />} />
          </div>
        </section>

        {/* ═══════ PRODUCT SHOWCASE CARDS (with embedded UI mockups) ═══════ */}
        <section className="bg-white px-6 py-20 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mb-14 text-center">
              <span className="mb-4 inline-block rounded-full border border-[#e4e4e7] bg-[#fafafa] px-5 py-1.5 text-[12px] font-bold tracking-[0.1em] text-[#0a0a0a] uppercase">
                The Pixnom Suite
              </span>
              <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl md:text-[48px] md:leading-[1.1]">
                Two tools. One workflow.
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-[16px] leading-[1.55] text-[#71717a]">
                Pick one or use both. Map2Web ships your site; Uptime keeps it healthy.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* ── MAP2WEB Showcase Card ── */}
              <div className="showcase-card overflow-hidden rounded-2xl border border-[#e4e4e7] bg-white">
                <div className="p-8">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="showcase-badge flex h-8 w-8 items-center justify-center rounded-lg border border-[#e4e4e7] bg-[#fafafa] text-[#0a0a0a] transition-all duration-300">
                      <Globe className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#f97316]">Build</span>
                  </div>
                  <h3 className="mb-2 text-2xl font-bold tracking-[-0.02em] text-[#0a0a0a]">AI Website Builder</h3>
                  <p className="mb-4 text-[14px] leading-[1.55] text-[#71717a]">
                    Generate a polished, SEO-ready website from your Google Maps listing — in under 60 seconds.
                  </p>
                  <Link href="/home/map2web/home" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#f97316] transition hover:gap-2.5">
                    Launch Map2Web <ArrowRightIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {/* Embedded UI Mockup */}
                <div className="border-t border-[#f4f4f5] bg-[#fafafa] px-6 pb-6 pt-5">
                  <div className="overflow-hidden rounded-xl border border-[#e4e4e7] bg-white shadow-sm">
                    {/* Mini browser bar */}
                    <div className="flex items-center gap-1.5 border-b border-[#f4f4f5] bg-[#fafafa] px-3 py-2">
                      <span className="h-2 w-2 rounded-full bg-[#fca5a5]" />
                      <span className="h-2 w-2 rounded-full bg-[#fde68a]" />
                      <span className="h-2 w-2 rounded-full bg-[#86efac]" />
                      <span className="ml-2 flex-1 rounded-md bg-[#f4f4f5] px-2 py-0.5 text-[9px] text-[#a1a1aa]">yoursite.pixnom.com</span>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <div className="mb-2 h-3 w-3/4 rounded bg-[#0a0a0a]" />
                          <div className="mb-1.5 h-2 w-full rounded bg-[#e4e4e7]" />
                          <div className="mb-3 h-2 w-2/3 rounded bg-[#e4e4e7]" />
                          <div className="flex gap-2">
                            <span className="rounded-md bg-[#f97316] px-3 py-1 text-[8px] font-bold text-white">Book Now</span>
                            <span className="rounded-md border border-[#e4e4e7] px-3 py-1 text-[8px] font-medium text-[#71717a]">Learn More</span>
                          </div>
                        </div>
                        <div className="rounded-lg bg-gradient-to-br from-[#f97316]/10 to-[#f97316]/5 p-2">
                          <div className="mb-1 h-2 w-full rounded bg-[#f97316]/20" />
                          <div className="mb-1 h-2 w-3/4 rounded bg-[#f97316]/15" />
                          <div className="h-6 w-full rounded bg-[#f97316]/10" />
                        </div>
                      </div>
                      {/* SEO Score badge */}
                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex items-center gap-1 rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-2.5 py-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                          <span className="text-[9px] font-semibold text-[#22c55e]">SEO Score: 94</span>
                        </div>
                        <div className="flex items-center gap-1 rounded-full border border-[#e4e4e7] bg-white px-2.5 py-1">
                          <Zap className="h-2.5 w-2.5 text-[#f97316]" />
                          <span className="text-[9px] font-medium text-[#71717a]">Mobile-first</span>
                        </div>
                        <div className="flex items-center gap-1 rounded-full border border-[#e4e4e7] bg-white px-2.5 py-1">
                          <Lock className="h-2.5 w-2.5 text-[#22c55e]" />
                          <span className="text-[9px] font-medium text-[#71717a]">SSL</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── UPTIME Showcase Card ── */}
              <div className="showcase-card overflow-hidden rounded-2xl border border-[#e4e4e7] bg-white">
                <div className="p-8">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="showcase-badge flex h-8 w-8 items-center justify-center rounded-lg border border-[#e4e4e7] bg-[#fafafa] text-[#0a0a0a] transition-all duration-300">
                      <Activity className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#f97316]">Monitor</span>
                  </div>
                  <h3 className="mb-2 text-2xl font-bold tracking-[-0.02em] text-[#0a0a0a]">Uptime Monitoring</h3>
                  <p className="mb-4 text-[14px] leading-[1.55] text-[#71717a]">
                    Know the moment anything breaks. Multi-protocol monitoring with beautiful status pages.
                  </p>
                  <Link href="/home/uptime" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#f97316] transition hover:gap-2.5">
                    Open Uptime <ArrowRightIcon className="h-3.5 w-3.5" />
                  </Link>
                </div>

                {/* Embedded Uptime Mockup */}
                <div className="border-t border-[#f4f4f5] bg-[#fafafa] px-6 pb-6 pt-5">
                  <div className="overflow-hidden rounded-xl border border-[#e4e4e7] bg-white shadow-sm">
                    <div className="p-4">
                      {/* Uptime header */}
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#a1a1aa]">Current Status</span>
                        <div className="flex items-center gap-1.5 rounded-full bg-[#f0fdf4] px-2.5 py-0.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
                          <span className="text-[10px] font-semibold text-[#22c55e]">All Systems Operational</span>
                        </div>
                      </div>
                      {/* Monitor rows */}
                      <div className="space-y-2">
                        <UptimeRow name="API Server" uptime="99.99%" ms="42ms" status="up" />
                        <UptimeRow name="Website" uptime="99.97%" ms="128ms" status="up" />
                        <UptimeRow name="Database" uptime="100%" ms="8ms" status="up" />
                      </div>
                      {/* Uptime bars */}
                      <div className="mt-3 border-t border-[#f4f4f5] pt-3">
                        <div className="mb-1 flex items-center justify-between text-[10px]">
                          <span className="font-medium text-[#71717a]">90-day uptime</span>
                          <span className="font-bold text-[#22c55e]">99.98%</span>
                        </div>
                        <div className="flex gap-[2px]">
                          {Array.from({ length: 30 }).map((_, i) => (
                            <div key={i} className={`h-4 flex-1 rounded-sm ${i === 18 ? 'bg-[#fbbf24]' : 'bg-[#22c55e]'}`} />
                          ))}
                        </div>
                        <div className="mt-1 flex justify-between text-[8px] text-[#a1a1aa]">
                          <span>90 days ago</span><span>Today</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════ HOW IT WORKS (Steps + Dashboard Screenshot) ═══════ */}
        <section className="border-t border-[#f4f4f5] bg-[#fafafa] px-6 py-20 md:py-28">
          <div className="mx-auto max-w-7xl">
            <div className="mb-14 text-center">
              <span className="mb-4 inline-block rounded-full bg-[#0a0a0a] px-5 py-1.5 text-[12px] font-bold tracking-[0.1em] text-white uppercase">
                How It Works
              </span>
              <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl md:text-[48px] md:leading-[1.1]">
                Get started in 3 simple steps
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-[16px] leading-[1.55] text-[#71717a]">
                No complexity, no long timelines. Just a clear path to digital growth.
              </p>
            </div>

            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
              {/* LEFT — Steps */}
              <div className="space-y-8">
                <NumberedStep num={1} title="Add your website" desc="Enter your domain and we'll analyze your Google presence, social profiles, and competitors across 50+ touchpoints." color="text-[#f97316]" />
                <NumberedStep num={2} title="Review your audit" desc="Get a prioritized action plan with specific, data-backed recommendations tailored to your industry and locality." color="text-[#f97316]" />
                <NumberedStep num={3} title="Watch it grow" desc="We handle implementation, automation setup, and ongoing optimization. Most clients see measurable results within 30 days." color="text-[#f97316]" />
              </div>

              {/* RIGHT — Rich Dashboard Mockup */}
              <div className="animate-float">
                <div className="shimmer-border overflow-hidden rounded-2xl border border-[#e4e4e7] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.06)]">
                  {/* Dashboard header */}
                  <div className="flex items-center justify-between border-b border-[#f4f4f5] bg-[#fafafa] px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f97316] text-[9px] font-bold text-white">P</div>
                      <span className="text-sm font-bold text-[#0a0a0a]">PixNom Dashboard</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#22c55e]">
                      <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e] animate-pulse" />
                      Live
                    </span>
                  </div>

                  <div className="p-5">
                    {/* Top SEO Opportunities row */}
                    <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#a1a1aa]">Top Opportunities</p>
                    <div className="mb-4 grid grid-cols-3 gap-2.5">
                      <OpportunityCard priority="High" title="Fix 12 broken links on your site" tag="SEO" tagColor="bg-[#fef3c7] text-[#d97706]" />
                      <OpportunityCard priority="Medium" title="Add meta descriptions to 8 pages" tag="Content" tagColor="bg-[#dbeafe] text-[#2563eb]" />
                      <OpportunityCard priority="High" title="Claim your Google Business listing" tag="Local" tagColor="bg-[#dcfce7] text-[#16a34a]" />
                    </div>

                    {/* Stats row with donut + bar chart */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Donut chart */}
                      <div className="rounded-xl border border-[#f4f4f5] bg-[#fafafa] p-3.5">
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Keyword Rankings</p>
                        <div className="flex items-center gap-3">
                          <div className="relative h-16 w-16 flex-shrink-0">
                            <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f4f4f5" strokeWidth="3" />
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#22c55e" strokeWidth="3" strokeDasharray="45 100" className="donut-animate" style={{ '--fill': '45' } as React.CSSProperties} />
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f97316" strokeWidth="3" strokeDasharray="25 100" strokeDashoffset="-45" />
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#fbbf24" strokeWidth="3" strokeDasharray="15 100" strokeDashoffset="-70" />
                            </svg>
                          </div>
                          <div className="space-y-1 text-[10px]">
                            <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#22c55e]" /> Top 3 — 24</div>
                            <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f97316]" /> Top 10 — 38</div>
                            <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#fbbf24]" /> Top 100 — 67</div>
                          </div>
                        </div>
                        <div className="mt-2.5 flex gap-3">
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-[#22c55e]">
                            <ArrowUp className="h-3 w-3" /> 5 moved up
                          </div>
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-[#ef4444]">
                            <ArrowDown className="h-3 w-3" /> 2 moved down
                          </div>
                        </div>
                      </div>

                      {/* Revenue bar chart */}
                      <div className="rounded-xl border border-[#f4f4f5] bg-[#fafafa] p-3.5">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Traffic Overview</p>
                          <span className="rounded-full bg-[#f0fdf4] px-2 py-0.5 text-[9px] font-semibold text-[#22c55e]">+65%</span>
                        </div>
                        <div className="flex items-end gap-1" style={{ height: 56 }}>
                          {[28, 35, 32, 45, 38, 50, 44, 58, 65, 72, 68, 80].map((h, i) => (
                            <div
                              key={i}
                              className={`bar-animate flex-1 rounded-sm ${i >= 10 ? 'bg-[#f97316]' : i >= 8 ? 'bg-[#fdba74]' : 'bg-[#e4e4e7]'}`}
                              style={{ height: `${h}%`, animationDelay: `${i * 0.06}s` }}
                            />
                          ))}
                        </div>
                        <div className="mt-1.5 flex justify-between text-[8px] text-[#a1a1aa]">
                          <span>Jan</span><span>Jun</span><span>Dec</span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-lg font-bold text-[#0a0a0a]">25,508</span>
                          <span className="text-[10px] text-[#71717a]">monthly visitors</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════ FEATURE GRID ═══════ */}
        <section className="bg-white px-6 py-20 md:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mb-14 text-center">
              <span className="mb-4 inline-block rounded-full border border-[#e4e4e7] bg-white px-5 py-1.5 text-[12px] font-bold tracking-[0.1em] text-[#0a0a0a] uppercase">
                Features
              </span>
              <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl md:text-[48px] md:leading-[1.1]">
                Everything you need to dominate online
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon={<Globe className="h-5 w-5" />} title="AI Website Builder" desc="Turn your Google Maps listing into a polished, SEO-ready website in under 60 seconds." />
              <FeatureCard icon={<Activity className="h-5 w-5" />} title="Uptime Monitoring" desc="HTTP, TCP, DNS, SSL checks with instant alerts via Email, Slack, Telegram & WhatsApp." />
              <FeatureCard icon={<Star className="h-5 w-5" />} title="Review Management" desc="Automated review requests that help you reach a 4.8+ star rating in 90 days." />
              <FeatureCard icon={<Bot className="h-5 w-5" />} title="AI Receptionist" desc="Never miss a call. AI answers 24/7, books appointments, and captures every lead." />
              <FeatureCard icon={<Eye className="h-5 w-5" />} title="Public Status Pages" desc="Beautiful, shareable status pages that build customer trust and transparency." />
              <FeatureCard icon={<TrendingUp className="h-5 w-5" />} title="Growth Analytics" desc="Track leads, traffic, revenue, and competitor performance from one dashboard." />
            </div>
          </div>
        </section>

        {/* ═══════ SOCIAL PROOF / INDUSTRIES ═══════ */}
        <section className="border-t border-[#f4f4f5] bg-[#fafafa] px-6 py-14">
          <div className="mx-auto max-w-6xl text-center">
            <p className="mb-6 text-[11px] font-semibold tracking-[0.2em] text-[#71717a] uppercase">
              Trusted by service businesses across India
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {[
                { icon: <Sparkles className="h-3.5 w-3.5" />, label: 'Cleaning' },
                { icon: <Camera className="h-3.5 w-3.5" />, label: 'Photography' },
                { icon: <ShieldCheck className="h-3.5 w-3.5" />, label: 'Security' },
                { icon: <Leaf className="h-3.5 w-3.5" />, label: 'Landscaping' },
                { icon: <UtensilsCrossed className="h-3.5 w-3.5" />, label: 'Restaurants' },
                { icon: <Wind className="h-3.5 w-3.5" />, label: 'AC Services' },
                { icon: <PaintBucket className="h-3.5 w-3.5" />, label: 'Interiors' },
                { icon: <Truck className="h-3.5 w-3.5" />, label: 'Movers' },
              ].map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5 rounded-full border border-[#e4e4e7] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#71717a] transition hover:border-[#f97316] hover:text-[#f97316]">
                  {item.icon}
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════ STATS BANNER ═══════ */}
        <section className="noise-bg bg-[#0a0a0a] px-6 py-16">
          <div className="relative mx-auto grid max-w-5xl grid-cols-2 gap-6 text-center md:grid-cols-4">
            <BannerStat value="50+" label="Touchpoints Analyzed" />
            <BannerStat value="90" label="Days to 4.8★ Rating" />
            <BannerStat value="24/7" label="AI Receptionist" />
            <BannerStat value="<60s" label="Site Generation Time" />
          </div>
        </section>

        {/* ═══════ WARM CTA BANNER (Neil Patel-style peach bg + search) ═══════ */}
        <section className="warm-cta-bg relative overflow-hidden px-6 py-20 text-center md:py-24">
          {/* Decorative circle */}
          <div className="absolute -right-20 -bottom-20 h-80 w-80 rounded-full bg-[#f97316] opacity-[0.05] blur-[60px]" />
          <div className="absolute -left-10 -top-10 h-60 w-60 rounded-full bg-[#f97316] opacity-[0.04] blur-[50px]" />

          <div className="relative mx-auto max-w-3xl">
            <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl md:text-[44px] md:leading-[1.1]">
              Add digital power to your business today
            </h2>
            <p className="mx-auto mt-4 mb-8 max-w-xl text-[16px] leading-[1.55] text-[#71717a]">
              Unlock free insights and quick wins to grow your online presence. No credit card required.
            </p>

            {/* Repeated search bar */}
            <div className="mx-auto max-w-lg">
              <div className="flex items-center gap-2 rounded-2xl border border-[#fdba74]/40 bg-white px-4 py-2 shadow-[0_4px_20px_rgba(249,115,22,0.08)]">
                <Search className="h-5 w-5 flex-shrink-0 text-[#a1a1aa]" />
                <input
                  type="text"
                  placeholder="Enter your website"
                  className="flex-1 bg-transparent py-2 text-[15px] text-[#0a0a0a] placeholder-[#a1a1aa] outline-none"
                />
                <Link href="/auth/sign-up" className="btn-primary flex-shrink-0 rounded-xl bg-[#f97316] px-6 py-2.5 text-sm font-semibold text-white">
                  Get Started
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════ FINAL CTA ═══════ */}
        <section className="relative overflow-hidden bg-white px-6 py-20 text-center md:py-28">
          <div className="absolute top-1/2 left-1/2 -z-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f97316] opacity-[0.03] blur-[100px]" />
          <div className="relative mx-auto max-w-3xl">
            <h2 className="text-3xl font-extrabold tracking-[-0.03em] text-[#0a0a0a] sm:text-4xl md:text-5xl md:leading-[1.1]">
              Ready to put your business{' '}
              <span className="gradient-text">online</span>?
            </h2>
            <p className="mx-auto mt-5 mb-9 max-w-xl text-[16px] leading-[1.55] text-[#71717a]">
              Start free with Map2Web. Add Uptime monitoring when you&apos;re ready.
            </p>
            <div className="inline-flex flex-wrap items-center justify-center gap-4">
              <Link href="/auth/sign-up" className="btn-primary inline-flex items-center gap-2.5 rounded-xl bg-[#f97316] px-8 py-4 text-[15px] font-semibold text-white">
                Get Started Free <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link href="https://pixnom.com/book-appointment.html" className="inline-flex items-center gap-2 rounded-xl border-2 border-[#0a0a0a] bg-white px-8 py-4 text-[15px] font-semibold text-[#0a0a0a] transition hover:bg-[#0a0a0a] hover:text-white">
                Contact Us
              </Link>
            </div>
          </div>
        </section>

      </div>
    </>
  );
}

export default Home;

/* ─────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────── */

function KPICard({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="stat-card rounded-xl border border-[#e4e4e7] bg-white px-5 py-4 text-center">
      <div className="mb-1 flex items-center justify-center gap-1.5">
        <span className="text-[#f97316]">{icon}</span>
        <span className="text-2xl font-extrabold tracking-tight text-[#0a0a0a] md:text-3xl">{value}</span>
      </div>
      <p className="text-[12px] font-medium text-[#71717a]">{label}</p>
    </div>
  );
}

function NumberedStep({ num, title, desc, color }: { num: number; title: string; desc: string; color: string }) {
  return (
    <div className="flex gap-5">
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#f97316]/20 text-2xl font-extrabold ${color}`}>
        {num}
      </div>
      <div>
        <h3 className="mb-1 text-xl font-bold text-[#0a0a0a]">{title}</h3>
        <p className="text-[14.5px] leading-[1.55] text-[#71717a]">{desc}</p>
      </div>
    </div>
  );
}

function OpportunityCard({ priority, title, tag, tagColor }: { priority: string; title: string; tag: string; tagColor: string }) {
  return (
    <div className="rounded-lg border border-[#f4f4f5] bg-white p-2.5 transition hover:border-[#f97316]/30">
      <div className="mb-1.5 flex items-center justify-between">
        <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${tagColor}`}>{tag}</span>
        <span className={`text-[8px] font-semibold ${priority === 'High' ? 'text-[#ef4444]' : 'text-[#f59e0b]'}`}>● {priority}</span>
      </div>
      <p className="text-[10px] leading-[1.4] font-medium text-[#0a0a0a]">{title}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[8px] text-[#a1a1aa]">Mark as done</span>
        <span className="rounded bg-[#f97316] px-2 py-0.5 text-[7px] font-bold text-white">START</span>
      </div>
    </div>
  );
}

function UptimeRow({ name, uptime, ms, status }: { name: string; uptime: string; ms: string; status: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#f4f4f5] bg-[#fafafa] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${status === 'up' ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
        <span className="text-[11px] font-medium text-[#0a0a0a]">{name}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-semibold text-[#22c55e]">{uptime}</span>
        <span className="rounded bg-[#fafafa] text-[10px] text-[#71717a]">{ms}</span>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="feature-card card-hover rounded-2xl border border-[#e4e4e7] bg-white p-7">
      <div className="feature-icon-box mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#e4e4e7] bg-[#fafafa] text-[#0a0a0a]">
        {icon}
      </div>
      <h3 className="mb-2 text-[16px] font-bold text-[#0a0a0a]">{title}</h3>
      <p className="text-[14px] leading-[1.55] text-[#71717a]">{desc}</p>
    </div>
  );
}

function BannerStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">{value}</div>
      <p className="mt-1.5 text-[13px] font-medium text-[#a1a1aa]">{label}</p>
    </div>
  );
}
