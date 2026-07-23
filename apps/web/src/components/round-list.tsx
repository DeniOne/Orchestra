import type { Round } from '@orchestra/domain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PhaseBadge } from '@/components/phase-badge';
import { ConfidenceGauges } from '@/components/confidence-gauges';
import { ScoreStaves } from '@/components/score-staves';
import { ConsensusPanel } from '@/components/consensus-panel';

const statusLabels: Record<string, string> = {
  pending: 'Ожидание',
  in_progress: 'В процессе',
  completed: 'Завершён',
  failed: 'Ошибка',
};

const statusColors: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export function RoundList({ rounds }: { rounds: Round[] }) {
  if (rounds.length === 0) {
    return <p className="text-sm text-muted-foreground">Раундов пока нет.</p>;
  }

  const sorted = [...rounds].reverse();

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Раунды</h3>
      {sorted.map((round) => (
        <Card key={round.id}>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Раунд #{round.number}</CardTitle>
              <div className="flex gap-2">
                <PhaseBadge phase={round.phase} />
                <Badge variant="outline" className={statusColors[round.status]}>
                  {statusLabels[round.status] ?? round.status}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 py-2 px-4">
            <p className="text-xs text-muted-foreground">
              Начат: {new Date(round.startedAt).toLocaleString('ru-RU')}
              {round.completedAt && (
                <> · Завершён: {new Date(round.completedAt).toLocaleString('ru-RU')}</>
              )}
            </p>

            {/* Conducting Score — Confidence gauges (UI Canon §2) */}
            {round.consensus && (
              <ConfidenceGauges confidence={round.consensus.confidence} phase={round.phase} />
            )}

            {/* Conducting Score — Role staves with real LLM content (UI Canon §1) */}
            {round.responses && round.responses.length > 0 && (
              <ScoreStaves responses={round.responses} />
            )}

            {/* Continuous Consensus panel (UI Canon §3) */}
            {round.consensus && <ConsensusPanel consensus={round.consensus} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
