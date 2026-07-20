'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import type { DomainEvent } from '@orchestra/domain';

export function useEventsSubscription(sessionIdFilter?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    const handler = (event: DomainEvent) => {
      if (sessionIdFilter && event.sessionId === sessionIdFilter) {
        qc.invalidateQueries({ queryKey: ['session', sessionIdFilter] });
      }
      if (!sessionIdFilter) {
        qc.invalidateQueries({ queryKey: ['sessions'] });
      }
    };

    socket.on('orchestra:event', handler);

    return () => {
      socket.off('orchestra:event', handler);
    };
  }, [qc, sessionIdFilter]);
}
