import { create } from 'zustand';

// Estado do service worker do PWA (ADR-0153, D4). registerType: 'prompt' não troca de versão
// sozinho — main.tsx registra o service worker e guarda aqui o sinal de versão nova e a função
// que aplica a troca, para o componente AtualizacaoDisponivel oferecer ao usuário.
interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  updateSW: ((reloadPage?: boolean) => Promise<void>) | null;
  setNeedRefresh: (needRefresh: boolean) => void;
  setOfflineReady: (offlineReady: boolean) => void;
  setUpdateSW: (updateSW: (reloadPage?: boolean) => Promise<void>) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  needRefresh: false,
  offlineReady: false,
  updateSW: null,
  setNeedRefresh: (needRefresh) => set({ needRefresh }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdateSW: (updateSW) => set({ updateSW }),
}));
