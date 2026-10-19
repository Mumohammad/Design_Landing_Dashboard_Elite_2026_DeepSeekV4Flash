import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { sendCompanyConfirmationEmail } from '@/lib/notifications/company-welcome-email';
import {
  rateLimitRegister,
  RateLimitError,
  RateLimitUnavailableError,
} from '@/lib/auth/rate-limit';
import { ERROR_CODES } from '@/lib/errors/error-codes';
import { isValidNewPassword, newPasswordHint } from '@/lib/auth/password-policy';

// FX-08: public registration password policy — min 10 chars, at least one
// letter and one digit (password "a" was previously accepted).
const registerSchema = z.object({
  company_name: z.string().min(2).max(200),
  domain: z.string().min(3).max(253),
  email: z.string().email().max(320),
  password: z.string().refine(isValidNewPassword, newPasswordHint('en')),
  logo_url: z.string().url().max(512).optional(),
  brand_colors: z.string().max(32).optional(),
});

// Best-effort client IP for the per-IP registration rate limit (same
// extraction as /api/auth/sign-in).
function ipFromRequest(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    // ── FX-08 guard #1: per-IP rate limit, FIRST (before any DB/auth work).
    // Fail closed → 503 when the limiter backend is unavailable.
    const ip = ipFromRequest(req);
    let rl;
    try {
      rl = await rateLimitRegister(ip);
    } catch (err) {
      if (err instanceof RateLimitUnavailableError) {
        // Fail closed — same bilingual envelope as /api/auth/sign-in.
        const unavailable = ERROR_CODES.RATE_LIMIT_UNAVAILABLE;
        return NextResponse.json(
          {
            code: unavailable.code,
            message_ar: unavailable.messageAr,
            message_en: unavailable.messageEn,
          },
          { status: 503 }
        );
      }
      throw err;
    }
    if (!rl.success) {
      const e = new RateLimitError(rl.resetAt, 10);
      return NextResponse.json(
        {
          code: e.code,
          message_ar: e.messageAr,
          message_en: e.messageEn,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(Math.ceil((rl.resetAt - Date.now()) / 1000), 1)),
          },
        }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { company_name, domain, email, password, logo_url, brand_colors } = body;

    if (!company_name || !domain || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── FX-08 guard #2: enforce the password policy (min 10 chars + letter +
    // number) and the full field shape server-side via zod. Weak passwords
    // previously reached admin.createUser and came back as a fake 200 through
    // the FX-07 anti-enumeration path.
    const parsed = registerSchema.safeParse({
      company_name,
      domain,
      email,
      password,
      logo_url: logo_url || undefined,
      brand_colors: brand_colors || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid registration details' }, { status: 400 });
    }

    const slug = company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const { data: existing } = await supabase.from('tenants').select('id').eq('domain', domain).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Domain already registered' }, { status: 409 });
    }

    // ── Email confirmation policy (step 3 of the flow: "if enabled") ──
    // Mirror the Supabase Auth project setting instead of hard-coding a
    // behavior, so enabling/disabling confirmation in the dashboard is the
    // only switch operators need to touch.
    let emailConfirmationEnabled = true;
    try {
      const settingsRes = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(6000),
      });
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (typeof settings.mailer_autoconfirm === 'boolean') {
          emailConfirmationEnabled = !settings.mailer_autoconfirm;
        }
      }
    } catch {
      // Fail safe: keep the stricter default (send a confirmation link).
    }

    // Invite-provisioned user creation — direct signup is blocked by the auth trigger.
    // When confirmation is enabled the account starts unconfirmed so the user
    // must click the emailed link before signing in.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: !emailConfirmationEnabled,
      app_metadata: { _invite_provisioned: true },
      user_metadata: { company_name, domain },
    });

    if (authError) {
      // FX-07 anti-enumeration: `admin.createUser` for an existing account
      // fails ("User already registered" …) and used to surface as a raw
      // error string. Existing and fresh emails must behave identically:
      // same status, same body. Details stay in server logs only.
      if (!['email_exists', 'user_already_exists'].includes(authError.code ?? '')) {
        return NextResponse.json({ error: 'Registration temporarily unavailable' }, { status: 503 });
      }
      return NextResponse.json(
        { success: true, requires_confirmation: emailConfirmationEnabled },
        { status: 200 }
);
    }
    if (!authData.user) throw new Error('Failed to create user');

    // Provision the tenant + membership + role rows BEFORE returning, so the
    // workspace is fully ready the moment the user signs in.
    const { error: provisionError } = await supabase.rpc('provision_company_atomic', {
      p_auth_user_id: authData.user.id,
      p_company: {
        name: company_name, slug, domain, logo_url: logo_url || null,
        brand_colors: { primary: brand_colors || '#1E5A99', secondary: '#E87D3E' },
      },
    });
    if (provisionError) {
      // Only a definite PostgreSQL rejection proves that the transaction rolled
      // back. A transport failure has an unknown outcome: retain the Auth user
      // for reconciliation instead of risking deletion of a committed owner.
      if (/^(22|23|42|P0)[A-Z0-9]{3}$/.test(provisionError.code ?? '')) {
        const { error: cleanupError } = await supabase.auth.admin.deleteUser(authData.user.id);
        if (cleanupError) console.error('Company provisioning requires reconciliation', { authUserId: authData.user.id });
      } else {
        console.error('Company provisioning outcome requires reconciliation', { authUserId: authData.user.id });
      }
      return NextResponse.json({ error: 'Registration unavailable. Please contact support before retrying.' }, { status: 503 });
    }

    // ── Confirmation step (only when the auth project requires it) ──
    if (emailConfirmationEnabled) {
      // Mint the same confirmation link Supabase would email, then send it
      // through Resend with the branded bilingual template.
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'signup',
        email,
        password,
      });

      if (linkError || !linkData?.properties?.action_link) {
        console.error('Confirmation link generation failed:', linkError);
        // Non-fatal: the user can still request a new link via forgot-password.
      } else {
        // Best-effort — never fail the registration over an email hiccup.
        await sendCompanyConfirmationEmail({
          email,
          companyName: company_name,
          confirmationUrl: linkData.properties.action_link,
        });
      }

      return NextResponse.json({ success: true, requires_confirmation: true });
    }

    // Email confirmation disabled → straight to sign-in with a success banner.
    return NextResponse.json({ success: true, requires_confirmation: false });
  } catch (error) {
    // FX-07: never relay raw error text — this catch previously returned
    // `error.message`, leaking PostgREST diagnostics (table/column names,
    // unique-violation details) to the client.
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
