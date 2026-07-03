import { useQuery } from '@tanstack/react-query';
import { calcularTarifaML, type Tarifa, type DimensoesFrete } from '@/lib/tarifa';

/**
 * Tarifa ML (Clássico/Premium) para preço+categoria, com `recebe` já líquido do frete do
 * vendedor. Recalcula quando preço/dimensões mudam (fazem parte da queryKey). `enabled` evita
 * chamar sem categoria ou preço válido. `dim` deve ser a mesma em todos os callers (card +
 * semáforo) para o react-query deduplicar a chamada e manter o líquido consistente.
 */
export function useTarifaML(preco: number, categoriaMlId: string | null, dim?: DimensoesFrete | null, aliquotaPct = 0) {
  return useQuery<Tarifa | null>({
    queryKey: ['tarifa', categoriaMlId, preco, dim?.alturaCm, dim?.larguraCm, dim?.comprimentoCm, dim?.pesoGramas, aliquotaPct],
    queryFn: () => calcularTarifaML(preco, categoriaMlId as string, dim, aliquotaPct),
    enabled: !!categoriaMlId && preco > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6h, alinhado ao cache da edge
  });
}
