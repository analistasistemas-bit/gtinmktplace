import { useQuery } from '@tanstack/react-query';
import { buscarFilaPosvenda, buscarTentativasAtivas } from '@/lib/posvenda';
import { classificar } from '@/lib/posvenda-fila';
import { useResumoMensagens } from '@/hooks/useMensagens';

export const QK_POSVENDA = ['posvenda'] as const;

export function useFilaPosvenda() {
  return useQuery({ queryKey: [...QK_POSVENDA, 'fila'], queryFn: buscarFilaPosvenda, staleTime: 60_000 });
}

export function useTentativasAtivas() {
  return useQuery({ queryKey: [...QK_POSVENDA, 'acoes'], queryFn: buscarTentativasAtivas, staleTime: 15_000 });
}

/** Badge da aba Pós-venda: urgentes + mensagens não lidas. */
export function usePosvendaBadge(): number {
  const fila = useFilaPosvenda().data;
  const naoLidas = useResumoMensagens().data?.naoLidas.total ?? 0;
  return (fila ?? []).filter((d) => classificar(d) === 'urgente').length + naoLidas;
}
