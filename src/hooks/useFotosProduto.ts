import { useQuery } from '@tanstack/react-query';
import { buscarFotos, type MapasFoto } from '@/lib/fotos-produto';

/** Fotos (storage path) das variações, para o thumbnail da visão por pedido. Cache longo (mudam pouco). */
export function useFotosProduto() {
  return useQuery<MapasFoto>({
    queryKey: ['fotos-produto'],
    queryFn: buscarFotos,
    staleTime: 30 * 60_000,
  });
}
