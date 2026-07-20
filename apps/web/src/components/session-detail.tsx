'use client';

import { useSession } from '@/hooks/use-session';
import { useEventsSubscription } from '@/hooks/use-events-subscription';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhaseBadge } from '@/components/phase-badge';
import { RoundList } from '@/components/round-list';
import { ConductControls } from '@/components/conduct-controls';

export function SessionDetail({ id }: { id: string }) {
  useEventsSubscription(id);
  const { data: session, isLoading, error } = useSession(id);

  if (isLoading) {
    return <p className="text-muted-foreground">Загрузка сессии...</p>;
  }

  if (error || !session) {
    return <p className="text-destructive">Сессия не найдена</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{session.name}</CardTitle>
            <PhaseBadge phase={session.currentPhase} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Проект: {session.projectId}
          </p>
          <p className="text-xs text-muted-foreground">
            Создано: {new Date(session.createdAt).toLocaleString('ru-RU')}
          </p>
          <p className="text-xs text-muted-foreground">
            Обновлено: {new Date(session.updatedAt).toLocaleString('ru-RU')}
          </p>
        </CardContent>
      </Card>

      <ConductControls sessionId={session.id} />

      <RoundList rounds={session.rounds} />
    </div>
  );
}
