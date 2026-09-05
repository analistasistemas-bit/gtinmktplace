import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ThemeProvider } from '@/components/theme-provider';
import { useAuthStore } from '@/stores/auth-store';
import { usePwaStore } from '@/stores/pwa-store';
import { queryClient } from '@/lib/query-client';
import './index.css';

useAuthStore.getState().hydrate();

// Registro do service worker (ADR-0153, D4). Único lugar do app que importa o virtual module —
// registerType: 'prompt' não recarrega sozinho, então o estado vai para a pwa-store e quem
// oferece a troca ao usuário é o componente AtualizacaoDisponivel.
const updateSW = registerSW({
  onNeedRefresh() {
    usePwaStore.getState().setNeedRefresh(true);
  },
  onOfflineReady() {
    usePwaStore.getState().setOfflineReady(true);
  },
  onRegisteredSW(_swScriptUrl, registration) {
    if (!registration) return;
    // Checagem periódica: quem deixa o app aberto por dias só descobre a versão nova assim
    // (a cada 60 min e ao voltar o foco da aba, conforme ADR-0153). update() rejeita sem rede —
    // cenário rotineiro num PWA instalado — então o erro é engolido, não é excepcional.
    const checarAtualizacao = () => void registration.update().catch(() => {});
    window.setInterval(checarAtualizacao, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checarAtualizacao();
    });
  },
});
usePwaStore.getState().setUpdateSW(updateSW);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
