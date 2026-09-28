import { useQuery } from '@tanstack/react-query';
import { fetchCatalogoVendasSku, type CatalogoSku } from '@/lib/vendas-sku-catalogo';

export function useCatalogoVendasSku() {
  return useQuery<CatalogoSku[]>({
    queryKey: ['vendas-sku-catalogo'],
    queryFn: fetchCatalogoVendasSku,
    staleTime: 10 * 60_000,
  });
}
