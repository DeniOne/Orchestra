import type { GSDPhase } from '@orchestra/domain';
import { Badge } from '@/components/ui/badge';

const phaseColors: Record<GSDPhase, string> = {
  Discover: 'bg-slate-100 text-slate-800 border-slate-300',
  Goal: 'bg-blue-100 text-blue-800 border-blue-300',
  Specification: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  Architecture: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  Implementation: 'bg-green-100 text-green-800 border-green-300',
  Review: 'bg-amber-100 text-amber-800 border-amber-300',
  Consensus: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  Iteration: 'bg-orange-100 text-orange-800 border-orange-300',
};

export function PhaseBadge({ phase }: { phase: GSDPhase }) {
  return (
    <Badge variant="outline" className={phaseColors[phase]}>
      {phase}
    </Badge>
  );
}
