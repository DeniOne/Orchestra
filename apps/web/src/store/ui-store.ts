import { create } from 'zustand';

interface UIState {
  createModalOpen: boolean;
  overrideModalOpen: boolean;
  overrideTargetSessionId: string | null;
  setCreateModalOpen: (open: boolean) => void;
  openOverride: (sessionId: string) => void;
  closeOverride: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  createModalOpen: false,
  overrideModalOpen: false,
  overrideTargetSessionId: null,
  setCreateModalOpen: (open) => set({ createModalOpen: open }),
  openOverride: (sessionId) =>
    set({ overrideModalOpen: true, overrideTargetSessionId: sessionId }),
  closeOverride: () =>
    set({ overrideModalOpen: false, overrideTargetSessionId: null }),
}));
