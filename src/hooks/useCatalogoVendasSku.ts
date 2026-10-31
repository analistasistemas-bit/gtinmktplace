import { useQuery } from '@tanstack/react-query';
import { fetchCatalogoVendasSku, type CatalogoSku } from '@/lib/vendas-sku-catalogo';
import { useOrgEfetivaId } from '@/hooks/useOrgEfetivaId';

export function useCatalogoVendasSku() {
  const orgId = useOrgEfetivaId();
  return useQuery<CatalogoSku[]>({
    queryKey: ['vendas-sku-catalogo', orgId],
    enabled: orgId != null,
    queryFn: fetchCatalogoVendasSku,
    staleTime: 10 * 60_000,
  });
}
