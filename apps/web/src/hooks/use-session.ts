import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { Session, Round } from '@orchestra/domain';
import type { AdvancePhaseResult } from '@/lib/types';

export function useSession(id: string) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => apiFetch<Session>(`/sessions/${id}`),
    enabled: !!id,
  });
}

export function useStartRound(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Round>(`/sessions/${id}/rounds`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });
}

export function useAdvance(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AdvancePhaseResult>(`/sessions/${id}/advance`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });
}

export function useApprove(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<Session>(`/sessions/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });
}

export function useOverride(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiFetch<Session>(`/sessions/${id}/override`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['session', id] }),
  });
}
