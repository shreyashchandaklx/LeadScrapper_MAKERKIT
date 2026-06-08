/* upload to /root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/leadscrapper/_components */

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import LeadscrapperFrameClient from './LeadscrapperFrameClient';

interface Props {
  page?: string;
  title: string;
}

export default async function LeadscrapperFrame({ page, title }: Props) {
  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const email = (user?.email || '').toLowerCase();

  const params = new URLSearchParams({ embed: 'true' });
  if (page) params.set('page', page);
  if (email) params.set('email', email);

  const src = `https://leadscrapper.pixnom.com?${params.toString()}`;

  return <LeadscrapperFrameClient src={src} page={page} title={title} />;
}
