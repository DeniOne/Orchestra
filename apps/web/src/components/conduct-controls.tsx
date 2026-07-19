'use client';

import { useState } from 'react';
import { useAdvance, useApprove, useOverride, useStartRound } from '@/hooks/use-session';
import { useUIStore } from '@/store/ui-store';
import type { AdvancePhaseResult } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Play, ChevronRight, Check, ShieldAlert } from 'lucide-react';

export function ConductControls({ sessionId }: { sessionId: string }) {
  const startRound = useStartRound(sessionId);
  const advance = useAdvance(sessionId);
  const approve = useApprove(sessionId);
  const overrideMutation = useOverride(sessionId);

  const overrideModalOpen = useUIStore((s) => s.overrideModalOpen);
  const overrideTargetSessionId = useUIStore((s) => s.overrideTargetSessionId);
  const openOverride = useUIStore((s) => s.openOverride);
  const closeOverride = useUIStore((s) => s.closeOverride);

  const [overrideReason, setOverrideReason] = useState('');
  const [lastAdvanceResult, setLastAdvanceResult] = useState<AdvancePhaseResult | null>(null);

  const isGated = lastAdvanceResult?.status === 'gated';

  function handleStartRound() {
    startRound.mutate(undefined, {
      onSuccess: () => toast.success('Раунд начат'),
      onError: (err) => toast.error(`Ошибка: ${(err as Error).message}`),
    });
  }

  function handleAdvance() {
    advance.mutate(undefined, {
      onSuccess: (result) => {
        setLastAdvanceResult(result);
        if (result.status === 'transitioned') {
          toast.success(`Переход: ${result.from} → ${result.to}`);
        } else if (result.status === 'gated') {
          toast.error(`Gating fail: ${result.gaps.join(', ')}`);
        } else if (result.status === 'awaiting_approval') {
          toast.info('Ожидает подтверждения (approval)');
        } else if (result.status === 'terminal') {
          toast.info(`Фаза ${result.phase} — терминальная`);
        } else if (result.status === 'iteration') {
          toast.warning(`Итерация: ${result.gaps.join(', ')}`);
        }
      },
      onError: (err) => {
        const msg = (err as Error).message;
        if (msg.includes('Postgres') || msg.includes('500')) {
          toast.error('Advance требует PostgreSQL. См. README-CONTRACT-PHASE-8 §3.');
        } else {
          toast.error(`Ошибка advance: ${msg}`);
        }
      },
    });
  }

  function handleApprove() {
    approve.mutate(undefined, {
      onSuccess: () => toast.success('Переход подтверждён'),
      onError: (err) => toast.error(`Ошибка: ${(err as Error).message}`),
    });
  }

  function handleOverrideSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideReason.trim()) return;

    overrideMutation.mutate(overrideReason.trim(), {
      onSuccess: () => {
        toast.success('Gate overridden');
        setOverrideReason('');
        closeOverride();
      },
      onError: (err) => toast.error(`Ошибка: ${(err as Error).message}`),
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={handleStartRound} disabled={startRound.isPending} size="sm">
          <Play className="mr-2 h-4 w-4" />
          Старт раунда
        </Button>

        <Button
          onClick={handleAdvance}
          disabled={advance.isPending || isGated}
          size="sm"
          variant="outline"
          title={isGated ? `Gating fail: ${lastAdvanceResult?.status === 'gated' ? lastAdvanceResult.gaps.join(', ') : ''}` : undefined}
        >
          <ChevronRight className="mr-2 h-4 w-4" />
          Advance
        </Button>

        <Button onClick={handleApprove} disabled={approve.isPending} size="sm" variant="outline">
          <Check className="mr-2 h-4 w-4" />
          Approve
        </Button>

        <Button
          onClick={() => openOverride(sessionId)}
          size="sm"
          variant="destructive"
        >
          <ShieldAlert className="mr-2 h-4 w-4" />
          Override
        </Button>
      </div>

      <Dialog
        open={overrideModalOpen && overrideTargetSessionId === sessionId}
        onOpenChange={(open) => { if (!open) closeOverride(); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Gate</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleOverrideSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="override-reason">Причина (обязательно)</Label>
              <Input
                id="override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Причина override"
                maxLength={1000}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeOverride}>
                Отмена
              </Button>
              <Button type="submit" variant="destructive" disabled={overrideMutation.isPending}>
                {overrideMutation.isPending ? 'Выполнение...' : 'Override'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
