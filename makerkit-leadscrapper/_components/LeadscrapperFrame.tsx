import { getSupabaseServerClient } from '@kit/supabase/server-client';

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

  return (
    <div className="h-[calc(100vh-4rem)]">
      <iframe
        src={src}
        className="h-full w-full border-0"
        title={title}
      />
    </div>
  );
}
