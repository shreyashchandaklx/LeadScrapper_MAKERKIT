// Deploy to:
//   /root/next-supabase-saas-kit-turbo-main/apps/web/app/api/supabase/credits/deduct-leads/route.ts
//
// Pricing: 1 credit = 100 leads  ->  1 lead = 0.01 credit

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { cleanEmail, isDevEmail } from '../../_lib';

const CREDIT_PER_LEAD = 0.01;

export async function POST(req: NextRequest) {

  const body = await req.json().catch(() => ({}));
  const email = cleanEmail(body.email);
  const leadCount = Number(body.leadCount);

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  if (!Number.isFinite(leadCount) || leadCount <= 0) {
    return NextResponse.json({ error: 'leadCount must be > 0' }, { status: 400 });
  }

  const charge = Number((leadCount * CREDIT_PER_LEAD).toFixed(2));
  console.log(`[Deduct] email="${email}" leadCount=${leadCount} charge=${charge}`);

  // Dev/owner emails get unlimited credits — same bypass as /credits/get.
  // Without this, dev users see 9999 in the UI but the deduct fails with 402
  // because their row in user_credits has balance=0 (or doesn't exist).
  if (isDevEmail(email)) {
    console.log(`[Deduct] Dev email "${email}" — bypassing deduction (charge=${charge}).`);
    return NextResponse.json({
      success: true,
      charged: 0,
      leadCount,
      remaining: 9999,
      isDev: true,
    });
  }

  const supabase = getSupabaseServerAdminClient();

  // Step 1: Find user's current balance
  const { data, error } = await supabase
    .from('user_credits')
    .select('Credits, Email')
    .ilike('Email', email)
    .maybeSingle();

  if (error) {
    console.error(`[Deduct] DB error looking up ${email}:`, error);
    return NextResponse.json({ error: 'Database error', details: error.message }, { status: 500 });
  }

  if (!data) {
    console.warn(`[Deduct] User "${email}" not found in user_credits. Allowing search but no deduction.`);
    // User not in DB — allow the search to proceed but log it
    return NextResponse.json({
      success: true,
      charged: 0,
      leadCount,
      remaining: 0,
      warning: 'User not found in credits table — no deduction made'
    });
  }

  const balance = Number(data.Credits);
  console.log(`[Deduct] Found user ${data.Email} with balance=${balance}, charge=${charge}`);

  if (balance < charge) {
    return NextResponse.json(
      {
        success: false,
        reason: 'insufficient',
        balance,
        required: charge,
      },
      { status: 402 },
    );
  }

  // Step 2: Deduct
  const newCredits = Number((balance - charge).toFixed(2));
  const { error: updateErr } = await supabase
    .from('user_credits')
    .update({ Credits: newCredits, UpdatedAt: new Date().toISOString() })
    .ilike('Email', email);

  if (updateErr) {
    console.error(`[Deduct] Failed to update credits for ${email}:`, updateErr);
    return NextResponse.json({ error: 'Failed to deduct credit', details: updateErr.message }, { status: 500 });
  }

  console.log(`[Deduct] SUCCESS: ${email} charged=${charge} remaining=${newCredits}`);

  return NextResponse.json({
    success: true,
    charged: charge,
    leadCount,
    remaining: newCredits,
  });
}
