import { useQuery } from '@tanstack/react-query';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';

/**
 * Comissão ML (Clássico/Premium) para preço+categoria. Recalcula quando o preço muda
 * (faz parte da queryKey). `enabled` evita chamar sem categoria ou preço válido.
 */
export function useTarifaML(preco: number, categoriaMlId: string | null) {
  return useQuery<Tarifa | null>({
    queryKey: ['tarifa', categoriaMlId, preco],
    queryFn: () => calcularTarifaML(preco, categoriaMlId as string),
    enabled: !!categoriaMlId && preco > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6h, alinhado ao cache da edge
  });
}
