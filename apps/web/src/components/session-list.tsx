'use client';

import { useSessions } from '@/hooks/use-sessions';
import { useUIStore } from '@/store/ui-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PhaseBadge } from '@/components/phase-badge';
import { Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Session } from '@orchestra/domain';

export function SessionList() {
  const { data: sessions, isLoading, error, refetch, isFetching } = useSessions();
  const setCreateModalOpen = useUIStore((s) => s.setCreateModalOpen);
  const router = useRouter();

  if (isLoading) {
    return <p className="text-muted-foreground">Загрузка сессий...</p>;
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-destructive">Не удалось загрузить сессии: {(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Сессии GSD</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button onClick={() => setCreateModalOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Новая сессия
          </Button>
        </div>
      </div>

      {sessions && sessions.length > 0 ? (
        <div className="space-y-2">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} onClick={() => router.push(`/sessions/${s.id}`)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-8">
          Нет сессий. Создайте первую.
        </p>
      )}
    </div>
  );
}

function SessionCard({ session, onClick }: { session: Session; onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:bg-accent transition-colors" onClick={onClick}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{session.name}</CardTitle>
          <PhaseBadge phase={session.currentPhase} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground">
          Проект: {session.projectId} · Раундов: {session.rounds.length} ·
          Обновлено: {new Date(session.updatedAt).toLocaleString('ru-RU')}
        </p>
      </CardContent>
    </Card>
  );
}
