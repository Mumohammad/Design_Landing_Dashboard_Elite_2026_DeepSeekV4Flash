'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import {
  recomputeDriverCompliance,
  type RecomputeResult,
} from '@/app/actions/drivers/recompute-compliance';
import type { ComplianceLevel, ComplianceResult } from '@/lib/drivers/compliance';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const levelMeta: Record<
  ComplianceLevel,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }
> = {
  fully_compliant: { label: 'Fully compliant', variant: 'default', icon: <CheckCircle2 className="h-4 w-4" /> },
  compliant_warnings: { label: 'Compliant (warnings)', variant: 'secondary', icon: <AlertCircle className="h-4 w-4" /> },
  pending_review: { label: 'Pending review', variant: 'secondary', icon: <RefreshCw className="h-4 w-4" /> },
  non_compliant: { label: 'Non-compliant', variant: 'destructive', icon: <XCircle className="h-4 w-4" /> },
  critical_block: { label: 'Critical block', variant: 'destructive', icon: <XCircle className="h-4 w-4" /> },
  suspended: { label: 'Suspended', variant: 'destructive', icon: <AlertCircle className="h-4 w-4" /> },
};

export function CompliancePanel({
  driverId,
  driver,
  latestResult,
}: {
  driverId: string;
  driver: { dispatch_eligible: boolean | null; compliance_risk_score: number | null };
  latestResult: ComplianceResult | null;
}) {
  const [result, setResult] = useState<RecomputeResult | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleRecompute = async () => {
    setIsPending(true);
    try {
      const out = await recomputeDriverCompliance({ driverId });
      setResult(out);
    } finally {
      setIsPending(false);
    }
  };

  const level = (result?.ok ? result.level : latestResult?.level) as ComplianceLevel | undefined;
  const score = result?.ok ? result.score : latestResult?.score;
  const blockers = result?.ok ? result.blockers : latestResult?.details.blockers;
  const missing = result?.ok ? result.missing : latestResult?.details.missing;
  const pending = result?.ok ? result.pending : latestResult?.details.pending;
  const warnings = result?.ok ? result.warnings : latestResult?.details.warnings;

  const meta = level ? levelMeta[level] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Compliance status
          <Button onClick={handleRecompute} disabled={isPending} size="sm" variant="outline">
            {isPending ? 'Computing…' : 'Recompute'}
          </Button>
        </CardTitle>
        <CardDescription>Saudi-2026 compliance evaluation for this driver</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          {meta && (
            <Badge variant={meta.variant} className="gap-1">
              {meta.icon}
              {meta.label}
            </Badge>
          )}
          {score !== undefined && (
            <span className="text-sm text-muted-foreground">Score: {score}/100</span>
          )}
          {driver.dispatch_eligible ? (
            <Badge variant="default">Dispatch eligible</Badge>
          ) : (
            <Badge variant="secondary">Not dispatch eligible</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>Blockers: {blockers ?? '—'}</div>
          <div>Missing: {missing ?? '—'}</div>
          <div>Pending: {pending ?? '—'}</div>
          <div>Warnings: {warnings ?? '—'}</div>
        </div>

        {latestResult && (
          <p className="text-xs text-muted-foreground">
            Last run: {new Date(latestResult.run_at).toLocaleString()}
          </p>
        )}

        {result && !result.ok && (
          <p className="text-sm text-destructive">{result.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
