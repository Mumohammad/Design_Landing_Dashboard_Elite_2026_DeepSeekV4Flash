import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CompliancePanel } from '@/components/drivers/compliance-panel';
import { getLatestResult } from '@/lib/drivers/compliance';

export default async function Driver360Page({
  params,
}: {
  params: Promise<{ driverId: string }>;
}) {
  const { driverId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // RLS on drivers enforces tenant isolation; a cross-tenant id 404s here.
  const { data: driver, error } = await supabase
    .from('drivers')
    .select(
      `
      id, full_name_ar, full_name_en, primary_mobile, status,
      identity_type, iqama_number, iqama_expiry_date,
      license_number, license_expiry_date,
      photo_url, blood_type, preferred_language,
      card_status, dispatch_eligible, compliance_risk_score,
      current_vehicle_id
    `
    )
    .eq('id', driverId)
    .single();

  if (error || !driver) notFound();

  const { data: latestResult } = await getLatestResult(driverId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {driver.full_name_ar || driver.full_name_en}
          </h1>
          <p className="text-sm text-muted-foreground">
            {driver.primary_mobile} • {driver.status}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Identity & licence</h2>
          <dl className="grid grid-cols-1 gap-2 rounded-lg border p-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Identity type</dt>
              <dd className="capitalize">{driver.identity_type}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Iqama / National ID</dt>
              <dd>{driver.iqama_number || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Identity expiry</dt>
              <dd>{driver.iqama_expiry_date || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Licence number</dt>
              <dd>{driver.license_number || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Licence expiry</dt>
              <dd>{driver.license_expiry_date || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Blood type</dt>
              <dd>{driver.blood_type || '—'}</dd>
            </div>
          </dl>
        </section>

        <section>
          <CompliancePanel
            driverId={driverId}
            driver={driver}
            latestResult={latestResult}
          />
        </section>
      </div>
    </div>
  );
}
