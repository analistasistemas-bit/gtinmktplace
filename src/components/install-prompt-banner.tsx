import { useEffect, useState } from 'react';
import { Download, X, Share2, PlusSquare } from 'lucide-react';
import { usePwaStore } from '@/stores/pwa-store';
import { isIOS as checkIsIOS, isStandalone as checkIsStandalone } from '@/lib/pwa-install';
import type { BeforeInstallPromptEvent } from '@/types/before-install-prompt';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function InstallPromptBanner() {
  const deferredPrompt = usePwaStore((state) => state.deferredPrompt);
  const isInstalled = usePwaStore((state) => state.isInstalled);
  const isDismissed = usePwaStore((state) => state.isDismissed);
  const showIOSPrompt = usePwaStore((state) => state.showIOSPrompt);
  const setDeferredPrompt = usePwaStore((state) => state.setDeferredPrompt);
  const setIsInstalled = usePwaStore((state) => state.setIsInstalled);
  const setShowIOSPrompt = usePwaStore((state) => state.setShowIOSPrompt);
  const dismissInstall = usePwaStore((state) => state.dismissInstall);
  const promptInstall = usePwaStore((state) => state.promptInstall);

  const [isIosDevice, setIsIosDevice] = useState(false);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);

  useEffect(() => {
    setIsIosDevice(checkIsIOS());
    setIsStandaloneApp(checkIsStandalone());

    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [setDeferredPrompt, setIsInstalled]);

  // Se já está instalado, se o usuário dispensou recentemente, ou se está em modo standalone, não renderiza
  if (isStandaloneApp || isInstalled || isDismissed) {
    return null;
  }

  // Só exibe se capturou o evento nativo de instalação OU se for um dispositivo iOS
  const canShowBanner = Boolean(deferredPrompt) || isIosDevice;
  if (!canShowBanner) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isIosDevice) {
      setShowIOSPrompt(true);
      return;
    }

    await promptInstall();
  };

  return (
    <>
      <div
        role="region"
        aria-label="Aviso de instalação do aplicativo"
        className="fixed bottom-4 right-4 z-50 w-[calc(100%-2rem)] sm:w-96 max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md text-zinc-100 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              <img
                src="/maskable-192.png"
                alt="PubliAI"
                className="w-full h-full object-cover"
                loading="eager"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm text-zinc-100 leading-tight">
                Instalar PubliAI
              </span>
              <p className="text-xs text-zinc-400 mt-1 leading-snug">
                Instale nosso app para uma experiência mais rápida e acesso offline
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => dismissInstall(7)}
            aria-label="Fechar"
            className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 p-1.5 rounded-lg transition-colors shrink-0 -mr-1 -mt-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full mt-3.5 inline-flex items-center justify-center gap-2 bg-white hover:bg-zinc-200 text-zinc-950 font-medium text-sm py-2 px-4 rounded-xl transition-all shadow-md active:scale-[0.98] cursor-pointer"
        >
          <Download className="w-4 h-4 text-zinc-950" />
          Instalar
        </button>
      </div>

      {/* Modal de instruções para iOS */}
      <Dialog
        open={showIOSPrompt}
        onOpenChange={(open) => {
          setShowIOSPrompt(open);
          if (!open) {
            dismissInstall();
          }
        }}
      >
        <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-zinc-100 text-lg flex items-center gap-2">
              <img
                src="/maskable-192.png"
                alt="PubliAI"
                className="w-6 h-6 rounded-md object-cover"
              />
              Como instalar no iOS
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              Siga os passos abaixo no Safari para adicionar o PubliAI à tela de início:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm text-zinc-200">
            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/40">
              <span className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                1
              </span>
              <p className="flex-1 leading-snug">
                Toque no botão de <strong>Compartilhar</strong> (
                <Share2 className="w-3.5 h-3.5 inline-block mx-0.5 text-zinc-300" />) na barra inferior
                do Safari.
              </p>
            </div>

            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/40">
              <span className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                2
              </span>
              <p className="flex-1 leading-snug">
                Role para baixo e selecione <strong>Adicionar à Tela de Início</strong> (
                <PlusSquare className="w-3.5 h-3.5 inline-block mx-0.5 text-zinc-300" />).
              </p>
            </div>

            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-zinc-800/60 border border-zinc-700/40">
              <span className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0">
                3
              </span>
              <p className="flex-1 leading-snug">
                Toque em <strong>Adicionar</strong> no canto superior direito da tela.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="default"
              className="bg-white hover:bg-zinc-200 text-zinc-950 font-medium"
              onClick={() => {
                setShowIOSPrompt(false);
                dismissInstall(7);
              }}
            >
              Entendi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
