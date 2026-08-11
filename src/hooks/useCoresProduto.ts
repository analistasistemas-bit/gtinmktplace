import { useQuery } from '@tanstack/react-query';
import { buscarCores, type MapasCor } from '@/lib/cor-produto';

/** Cores das variações, p/ a coluna "Cor" do detalhe do pedido. Cache longo (mudam pouco). */
export function useCoresProduto() {
  return useQuery<MapasCor>({
    queryKey: ['cores-produto'],
    queryFn: buscarCores,
    staleTime: 30 * 60_000,
  });
}
