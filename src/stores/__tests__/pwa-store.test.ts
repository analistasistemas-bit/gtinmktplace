import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePwaStore } from '../pwa-store';
import type { BeforeInstallPromptEvent } from '@/types/before-install-prompt';

describe('pwa store', () => {
  beforeEach(() => {
    localStorage.clear();
    usePwaStore.setState({
      needRefresh: false,
      offlineReady: false,
      updateSW: null,
      deferredPrompt: null,
      isInstalled: false,
      isDismissed: false,
      showIOSPrompt: false,
    });
  });

  it('começa sem versão nova e sem função de atualização', () => {
    expect(usePwaStore.getState()).toMatchObject({
      needRefresh: false,
      offlineReady: false,
      updateSW: null,
      deferredPrompt: null,
      isInstalled: false,
      isDismissed: false,
      showIOSPrompt: false,
    });
  });

  it('registra o sinal de versão nova (onNeedRefresh do service worker)', () => {
    usePwaStore.getState().setNeedRefresh(true);

    expect(usePwaStore.getState().needRefresh).toBe(true);
  });

  it('registra o precache concluído (onOfflineReady do service worker)', () => {
    usePwaStore.getState().setOfflineReady(true);

    expect(usePwaStore.getState().offlineReady).toBe(true);
  });

  it('guarda a função updateSW para o componente de aviso poder aplicar a troca', async () => {
    const updateSW = async () => {};
    usePwaStore.getState().setUpdateSW(updateSW);

    expect(usePwaStore.getState().updateSW).toBe(updateSW);
  });

  describe('PWA install prompt state and actions', () => {
    it('armazena e limpa o deferredPrompt', () => {
      const mockEvent = {
        platforms: ['webapp'],
        userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
        prompt: vi.fn().mockResolvedValue(undefined),
      } as unknown as BeforeInstallPromptEvent;

      usePwaStore.getState().setDeferredPrompt(mockEvent);
      expect(usePwaStore.getState().deferredPrompt).toBe(mockEvent);

      usePwaStore.getState().setDeferredPrompt(null);
      expect(usePwaStore.getState().deferredPrompt).toBeNull();
    });

    it('registra se o app já foi instalado e limpa o prompt diferido', () => {
      usePwaStore.getState().setIsInstalled(true);
      expect(usePwaStore.getState().isInstalled).toBe(true);
    });

    it('permite abrir e fechar as instruções do iOS', () => {
      usePwaStore.getState().setShowIOSPrompt(true);
      expect(usePwaStore.getState().showIOSPrompt).toBe(true);

      usePwaStore.getState().setShowIOSPrompt(false);
      expect(usePwaStore.getState().showIOSPrompt).toBe(false);
    });

    it('dismissInstall define isDismissed como true e grava cooldown no localStorage', () => {
      usePwaStore.getState().dismissInstall(7);
      expect(usePwaStore.getState().isDismissed).toBe(true);
      expect(localStorage.getItem('pwa_install_dismissed_until')).not.toBeNull();
    });

    it('promptInstall chama o prompt nativo e limpa o deferredPrompt após escolha do usuário', async () => {
      const promptFn = vi.fn().mockResolvedValue(undefined);
      const mockEvent = {
        platforms: ['webapp'],
        userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
        prompt: promptFn,
      } as unknown as BeforeInstallPromptEvent;

      usePwaStore.getState().setDeferredPrompt(mockEvent);

      const outcome = await usePwaStore.getState().promptInstall();

      expect(promptFn).toHaveBeenCalledTimes(1);
      expect(outcome).toBe('accepted');
      expect(usePwaStore.getState().deferredPrompt).toBeNull();
    });

    it('promptInstall retorna null se não houver deferredPrompt', async () => {
      const outcome = await usePwaStore.getState().promptInstall();
      expect(outcome).toBeNull();
    });
  });
});
