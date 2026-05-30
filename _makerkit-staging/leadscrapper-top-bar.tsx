import Link from 'next/link';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { ServicesDropdown } from './services-dropdown';
import { NeedHelpDropdown } from './need-help-dropdown';

const BILLING_URL  = '/home/billing';
const CREDITS_MAX  = 1000; // visual cap for the orange bar; bar fills proportionally up to this

// Fetches user credits from the same user_credits table the apify-proxy reads.
// Mirrors logic in apps/web/app/api/supabase/credits/get/route.ts.
async function fetchCredits(): Promise<number | null> {
  try {
    const userClient = getSupabaseServerClient();
    const { data: { user } } = await userClient.auth.getUser();
    const email = (user?.email || '').toLowerCase().trim();
    if (!email) return null;

    const admin = getSupabaseServerAdminClient();
    const { data, error } = await admin
      .from('user_credits')
      .select('Credits')
      .ilike('Email', email)
      .maybeSingle();
    if (error || !data) return null;
    return Number(data.Credits) || 0;
  } catch (err) {
    console.error('[LeadscrapperTopBar] credits fetch failed:', err);
    return null;
  }
}

export async function LeadscrapperTopBar() {
  const credits = await fetchCredits();
  const pct = credits === null ? 0 : Math.min(100, Math.max(4, (credits / CREDITS_MAX) * 100));

  return (
    <header className="w-full bg-background border-b border-border px-4 h-12 flex items-center gap-4 flex-shrink-0">
      <ServicesDropdown />

      <Link
        href={BILLING_URL}
        className="text-sm text-muted-foreground hover:text-foreground px-2 py-1.5 rounded transition-colors"
      >
        Plans &amp; Pricing
      </Link>

      <div className="flex-1" />

      <div className="hidden md:flex items-center gap-2">
        <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-orange-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {credits === null ? 'â€¦ Credits left' : `${credits.toLocaleString()} Credits left`}
        </span>
      </div>

      <Link
        href={BILLING_URL}
        className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-xs font-medium transition-colors"
      >
        Upgrade
      </Link>

      <NeedHelpDropdown />
    </header>
  );
}
