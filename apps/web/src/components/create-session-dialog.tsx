'use client';

import { useState } from 'react';
import { useCreateSession } from '@/hooks/use-sessions';
import { useUIStore } from '@/store/ui-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function CreateSessionDialog() {
  const open = useUIStore((s) => s.createModalOpen);
  const setOpen = useUIStore((s) => s.setCreateModalOpen);
  const createSession = useCreateSession();
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !projectId.trim()) return;

    createSession.mutate(
      { name: name.trim(), projectId: projectId.trim() },
      {
        onSuccess: () => {
          toast.success('Сессия создана');
          setName('');
          setProjectId('');
          setOpen(false);
        },
        onError: (err) => {
          toast.error(`Не удалось создать сессию: ${(err as Error).message}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая сессия</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="session-name">Название</Label>
            <Input
              id="session-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя сессии"
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-project">ID проекта</Label>
            <Input
              id="session-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="project-id"
              maxLength={100}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={createSession.isPending}>
              {createSession.isPending ? 'Создание...' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
