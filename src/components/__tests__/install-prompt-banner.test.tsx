import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InstallPromptBanner } from '../install-prompt-banner';
import { usePwaStore } from '@/stores/pwa-store';
import * as pwaInstallUtils from '@/lib/pwa-install';
import type { BeforeInstallPromptEvent } from '@/types/before-install-prompt';

describe('InstallPromptBanner', () => {
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
    vi.restoreAllMocks();
    vi.spyOn(pwaInstallUtils, 'isStandalone').mockReturnValue(false);
    vi.spyOn(pwaInstallUtils, 'isIOS').mockReturnValue(false);
    vi.spyOn(pwaInstallUtils, 'isDismissed').mockReturnValue(false);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('não renderiza nada se já estiver no modo standalone', () => {
    vi.spyOn(pwaInstallUtils, 'isStandalone').mockReturnValue(true);

    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('não renderiza nada se o cooldown de descarte estiver ativo', () => {
    usePwaStore.setState({ isDismissed: true });

    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('não renderiza nada se não houver prompt nem for iOS', () => {
    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renderiza o banner quando o evento beforeinstallprompt é disparado', () => {
    render(<InstallPromptBanner />);

    const mockPromptEvent = new Event('beforeinstallprompt') as unknown as BeforeInstallPromptEvent;
    Object.assign(mockPromptEvent, {
      platforms: ['web'],
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      prompt: vi.fn(),
    });

    act(() => {
      window.dispatchEvent(mockPromptEvent as unknown as Event);
    });

    expect(screen.getByText('Instalar PubliAI')).toBeInTheDocument();
    expect(
      screen.getByText('Instale nosso app para uma experiência mais rápida e acesso offline')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /instalar/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Fechar')).toBeInTheDocument();
  });

  it('ao clicar no botão fechar (✕), chama dismissInstall e oculta o banner', () => {
    render(<InstallPromptBanner />);

    const mockPromptEvent = new Event('beforeinstallprompt') as unknown as BeforeInstallPromptEvent;
    Object.assign(mockPromptEvent, {
      platforms: ['web'],
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      prompt: vi.fn(),
    });

    act(() => {
      window.dispatchEvent(mockPromptEvent as unknown as Event);
    });

    const closeBtn = screen.getByLabelText('Fechar');
    fireEvent.click(closeBtn);

    expect(usePwaStore.getState().isDismissed).toBe(true);
    expect(screen.queryByText('Instalar PubliAI')).not.toBeInTheDocument();
  });

  it('ao clicar em Instalar, executa promptInstall', async () => {
    const promptMock = vi.fn().mockResolvedValue(undefined);
    const mockPromptEvent = {
      platforms: ['web'],
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
      prompt: promptMock,
      preventDefault: vi.fn(),
    } as unknown as BeforeInstallPromptEvent;

    usePwaStore.getState().setDeferredPrompt(mockPromptEvent);

    render(<InstallPromptBanner />);

    const installBtn = screen.getByRole('button', { name: /instalar/i });
    await act(async () => {
      fireEvent.click(installBtn);
    });

    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it('oculta o banner quando o evento appinstalled é disparado', () => {
    const mockPromptEvent = {
      platforms: ['web'],
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
      prompt: vi.fn(),
    } as unknown as BeforeInstallPromptEvent;

    usePwaStore.getState().setDeferredPrompt(mockPromptEvent);

    render(<InstallPromptBanner />);
    expect(screen.getByText('Instalar PubliAI')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(usePwaStore.getState().isInstalled).toBe(true);
    expect(screen.queryByText('Instalar PubliAI')).not.toBeInTheDocument();
  });

  it('em dispositivos iOS, renderiza o banner e ao clicar exibe o modal de instruções', () => {
    vi.spyOn(pwaInstallUtils, 'isIOS').mockReturnValue(true);

    render(<InstallPromptBanner />);

    expect(screen.getByText('Instalar PubliAI')).toBeInTheDocument();

    const installBtn = screen.getByRole('button', { name: /instalar/i });
    fireEvent.click(installBtn);

    expect(screen.getByText('Como instalar no iOS')).toBeInTheDocument();
    expect(screen.getByText(/Compartilhar/i)).toBeInTheDocument();
    expect(screen.getByText(/Adicionar à Tela de Início/i)).toBeInTheDocument();

    const entendiBtn = screen.getByRole('button', { name: /entendi/i });
    fireEvent.click(entendiBtn);

    expect(usePwaStore.getState().isDismissed).toBe(true);
    expect(screen.queryByText('Instalar PubliAI')).not.toBeInTheDocument();
  });
});
