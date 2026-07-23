'use client';

import type { ConsensusReport } from '@orchestra/domain';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

/**
 * UI Canon §3 — Continuous Consensus display.
 * summary + gating verdict banner + disagreements + open questions + risks.
 */
export function ConsensusPanel({ consensus }: { consensus: ConsensusReport }) {
  const passed = consensus.gatingVerdict === 'pass';

  return (
    <div className="space-y-3">
      {/* Gating verdict banner */}
      <div
        className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
          passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}
      >
        {passed ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <XCircle className="h-4 w-4" />
        )}
        Gating: {passed ? 'PASS' : 'FAIL'}
      </div>

      {/* Summary */}
      {consensus.summary && (
        <p className="text-xs text-muted-foreground">{consensus.summary}</p>
      )}

      {/* Disagreements */}
      {consensus.disagreements.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            Разногласия ({consensus.disagreements.length})
          </div>
          {consensus.disagreements.map((d, i) => (
            <div key={d.id ?? i} className="rounded border border-amber-200/60 bg-amber-50/40 px-2 py-1.5">
              <p className="text-xs font-medium text-foreground">{d.topic}</p>
              {d.positions.map((p, j) => (
                <p key={j} className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium">{p.role.displayName ?? p.role.id}:</span> {p.claim}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Open questions */}
      {consensus.openQuestions.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600">
            <HelpCircle className="h-3.5 w-3.5" />
            Открытые вопросы ({consensus.openQuestions.length})
          </div>
          {consensus.openQuestions.map((q, i) => (
            <p key={q.id ?? i} className="text-xs text-muted-foreground">
              {q.text}
              {q.askedBy && <span className="ml-1 text-muted-foreground/70">— {q.askedBy.displayName ?? q.askedBy.id}</span>}
            </p>
          ))}
        </div>
      )}

      {/* Risks */}
      {consensus.risks.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-red-600">
            <ShieldAlert className="h-3.5 w-3.5" />
            Риски ({consensus.risks.length})
          </div>
          {consensus.risks.map((r, i) => (
            <div key={r.id ?? i} className="flex items-start gap-2">
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] ${
                  r.severity === 'critical' || r.severity === 'high'
                    ? 'border-red-300 text-red-600'
                    : r.severity === 'medium'
                      ? 'border-amber-300 text-amber-600'
                      : 'border-slate-300 text-slate-500'
                }`}
              >
                {r.severity}
              </Badge>
              <div className="min-w-0">
                <p className="text-xs text-foreground">{r.description}</p>
                {r.mitigation && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Mitigation: {r.mitigation}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
