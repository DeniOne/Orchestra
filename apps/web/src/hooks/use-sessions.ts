import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Session } from '@orchestra/domain';

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiFetch<Session[]>('/sessions'),
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; projectId: string }) =>
      apiFetch<Session>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
