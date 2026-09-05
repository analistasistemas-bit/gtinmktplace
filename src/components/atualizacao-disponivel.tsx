import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { usePwaStore } from '@/stores/pwa-store';

// Aviso de nova versão do app (ADR-0153, D4). Dispara só quando o service worker novo já
// baixou e está esperando ativação — sem duração, sem recarregar sozinho: quem decide é o
// usuário, clicando em "Atualizar".
export function AtualizacaoDisponivel() {
  const needRefresh = usePwaStore((state) => state.needRefresh);
  const updateSW = usePwaStore((state) => state.updateSW);
  const toastId = useRef<string | number>(undefined);

  useEffect(() => {
    if (!needRefresh) return;
    toastId.current = toast('Nova versão disponível', {
      description: 'Atualize para usar a versão mais recente do app.',
      duration: Infinity,
      action: {
        label: 'Atualizar',
        onClick: () => void updateSW?.(true),
      },
    });
    return () => {
      if (toastId.current !== undefined) toast.dismiss(toastId.current);
    };
  }, [needRefresh, updateSW]);

  return null;
}
