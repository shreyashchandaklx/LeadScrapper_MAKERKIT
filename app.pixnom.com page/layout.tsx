import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { SiteFooter } from '~/(marketing)/_components/site-footer';
import { SiteHeader } from '~/(marketing)/_components/site-header';
import { AppSidebar } from '~/(marketing)/_components/app-sidebar';

export const dynamic = 'force-dynamic';

async function SiteLayout(props: React.PropsWithChildren) {
  const client = getSupabaseServerClient();
  const user = await requireUser(client, { verifyMfa: false });

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SiteHeader user={user.data} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {props.children}
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}

export default SiteLayout;
