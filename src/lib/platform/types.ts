// =====================================================
// Platform B2B — TypeScript Types
// =====================================================

export type PlanTier = 'starter' | 'pro' | 'enterprise';
export type UserRole = 'admin' | 'manager' | 'viewer';
export type TrialStatus = 'active' | 'converted' | 'rejected';
export type SubscriptionStatus = 'active' | 'cancelled' | 'past_due' | 'trial';

export interface BrandColors {
  primary: string;
  secondary: string;
  background: string;
}

export interface PlatformCompany {
  id: string;
  name: string;
  legal_name: string;
  domain: string;
  slug: string;
  logo_url: string | null;
  brand_colors: BrandColors;
  plan_tier: PlanTier;
  drivers_limit: number;
  vehicles_limit: number;
  drivers_count: number;
  vehicles_count: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PlatformUser {
  id: string;
  company_id: string;
  role: UserRole;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformTrial {
  id: string;
  company_id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string | null;
  driver_license: string | null;
  rating: number | null;
  feedback: string | null;
  status: TrialStatus;
  started_at: string;
  ended_at: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformSubscription {
  id: string;
  company_id: string;
  plan_tier: PlanTier;
  status: SubscriptionStatus;
  start_date: string;
  end_date: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PricingPlan {
  tier: PlanTier;
  name: string;
  price: number;
  period: 'month' | 'year';
  drivers_limit: number;
  vehicles_limit: number;
  features: string[];
  popular?: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    tier: 'starter',
    name: 'Starter',
    price: 299,
    period: 'month',
    drivers_limit: 10,
    vehicles_limit: 10,
    features: [
      'Up to 10 drivers',
      'Up to 10 vehicles',
      'Basic analytics',
      'Email support',
      'Standard branding',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: 799,
    period: 'month',
    drivers_limit: 50,
    vehicles_limit: 50,
    features: [
      'Up to 50 drivers',
      'Up to 50 vehicles',
      'Advanced analytics',
      'Priority support',
      'Custom branding',
      'Reverse trials',
      'API access',
    ],
    popular: true,
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    price: 1999,
    period: 'month',
    drivers_limit: 999999,
    vehicles_limit: 999999,
    features: [
      'Unlimited drivers',
      'Unlimited vehicles',
      'Custom analytics',
      '24/7 dedicated support',
      'Full white-label',
      'Unlimited trials',
      'Full API access',
      'Custom integrations',
      'SLA guarantee',
    ],
  },
];
