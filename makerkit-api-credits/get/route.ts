// Deploy to:
//   /root/next-supabase-saas-kit-turbo-main/apps/web/app/api/supabase/credits/get/route.ts
//
// Returns the user's current balance from user_credits table.
// Pricing: 1 credit = 1 lead

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { cleanEmail, isDevEmail } from '../../_lib';

const CREDIT_PER_LEAD = 1;
const LEADS_PER_CREDIT = 1;

export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url);
  const email = cleanEmail(searchParams.get('email'));

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  // Check dev emails (e.g. for testing without database rows)
  if (isDevEmail(email)) {
    return NextResponse.json({
      email,
      credits: 9999,
      creditPerLead: CREDIT_PER_LEAD,
      leadsPerCredit: LEADS_PER_CREDIT,
      isDev: true
    });
  }

  const supabase = getSupabaseServerAdminClient();
  
  // Debug log (check your server logs/pm2 logs)
  console.log(`[Credits] Searching for balance for: "${email}"`);

  // Using a more robust query to handle potential whitespace in the DB
  const { data, error } = await supabase
    .from('user_credits')
    .select('Credits, Email')
    .ilike('Email', email.trim())
    .maybeSingle(); // maybeSingle is safer than .single() if multiple matches exist

  if (error) {
    console.error(`[Credits] Database error for ${email}:`, error);
    return NextResponse.json({ error: 'Database query failed', details: error }, { status: 500 });
  }

  if (!data) {
    console.log(`[Credits] User "${email}" not found in user_credits table.`);
    return NextResponse.json({
      email,
      credits: 0,
      creditPerLead: CREDIT_PER_LEAD,
      leadsPerCredit: LEADS_PER_CREDIT,
      status: 'User not found in database'
    });
  }

  console.log(`[Credits] Found user ${data.Email}: ${data.Credits} credits.`);

  return NextResponse.json({
    email: data.Email,
    credits: Number(data.Credits),
    creditPerLead: CREDIT_PER_LEAD,
    leadsPerCredit: LEADS_PER_CREDIT
  });
}
