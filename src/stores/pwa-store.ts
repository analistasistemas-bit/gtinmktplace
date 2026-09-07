import { create } from 'zustand';
import { isDismissed as checkIsDismissed, setDismissCooldown } from '@/lib/pwa-install';
import type { BeforeInstallPromptEvent } from '@/types/before-install-prompt';

// Estado do service worker e instalação do PWA (ADR-0153, D4).
// Gerencia tanto a atualização do service worker quanto o fluxo de prompt de instalação PWA.
interface PwaState {
  // Service Worker update state
  needRefresh: boolean;
  offlineReady: boolean;
  updateSW: ((reloadPage?: boolean) => Promise<void>) | null;
  setNeedRefresh: (needRefresh: boolean) => void;
  setOfflineReady: (offlineReady: boolean) => void;
  setUpdateSW: (updateSW: (reloadPage?: boolean) => Promise<void>) => void;

  // PWA Install prompt state
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  isDismissed: boolean;
  showIOSPrompt: boolean;
  setDeferredPrompt: (prompt: BeforeInstallPromptEvent | null) => void;
  setIsInstalled: (isInstalled: boolean) => void;
  setIsDismissed: (isDismissed: boolean) => void;
  setShowIOSPrompt: (show: boolean) => void;
  dismissInstall: (days?: number) => void;
  promptInstall: () => Promise<'accepted' | 'dismissed' | null>;
}

export const usePwaStore = create<PwaState>((set, get) => ({
  needRefresh: false,
  offlineReady: false,
  updateSW: null,
  setNeedRefresh: (needRefresh) => set({ needRefresh }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdateSW: (updateSW) => set({ updateSW }),

  deferredPrompt: null,
  isInstalled: false,
  isDismissed: checkIsDismissed(),
  showIOSPrompt: false,
  setDeferredPrompt: (deferredPrompt) => set({ deferredPrompt }),
  setIsInstalled: (isInstalled) => set({ isInstalled, deferredPrompt: null }),
  setIsDismissed: (isDismissed) => set({ isDismissed }),
  setShowIOSPrompt: (showIOSPrompt) => set({ showIOSPrompt }),
  dismissInstall: (days = 7) => {
    setDismissCooldown(days);
    set({ isDismissed: true });
  },
  promptInstall: async () => {
    const prompt = get().deferredPrompt;
    if (!prompt) return null;

    await prompt.prompt();
    const choice = await prompt.userChoice;
    set({ deferredPrompt: null });
    return choice.outcome;
  },
}));
