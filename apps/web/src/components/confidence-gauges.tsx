'use client';

import type { DecisionConfidence, GSDPhase } from '@orchestra/domain';

/**
 * UI Canon §2 — Decision Confidence gauges.
 * 5 метрик (НЕ overall — Canon §9.2 запрещает сводный %): bars с green/yellow/red по threshold фазы.
 */
export function ConfidenceGauges({
  confidence,
  phase,
}: {
  confidence: DecisionConfidence;
  phase: GSDPhase;
}) {
  const threshold = THRESHOLDS[phase];

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">Decision Confidence</h4>
      <div className="space-y-1.5">
        {GAUGE_METRICS.map(({ key, label }) => {
          const value = confidence[key];
          const thresh = threshold?.[key];
          return (
            <GaugeBar key={key} label={label} value={value} threshold={thresh} />
          );
        })}
      </div>
    </div>
  );
}

function GaugeBar({
  label,
  value,
  threshold,
}: {
  label: string;
  value: number;
  threshold?: number;
}) {
  const color = threshold === undefined ? 'bg-emerald-500' : value >= threshold
    ? 'bg-emerald-500'
    : value >= threshold - 5
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

const GAUGE_METRICS: { key: keyof Omit<DecisionConfidence, 'overall'>; label: string }[] = [
  { key: 'architecture', label: 'Архитектура' },
  { key: 'implementation', label: 'Реализация' },
  { key: 'researchCoverage', label: 'Исследования' },
  { key: 'riskCoverage', label: 'Риски' },
  { key: 'testCoverage', label: 'Тесты' },
];

/** Mirror of gating-thresholds.ts (consensus-engine). MVP: hardcoded. */
const THRESHOLDS: Partial<Record<GSDPhase, Partial<DecisionConfidence>>> = {
  Goal: { architecture: 70 },
  Specification: { researchCoverage: 75 },
  Architecture: { architecture: 85 },
  Implementation: { implementation: 80 },
  Review: { riskCoverage: 70 },
  Consensus: { overall: 80 },
};
