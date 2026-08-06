import { useQuery } from '@tanstack/react-query';
import { buscarMapaCanonico, type MapaCanonico } from '@/lib/anuncio-canonico';

/** Vínculos de catálogo (MLB de catálogo → anúncio dono), para as vendas por catálogo somarem no
 *  produto original nos rankings. Cache longo: só muda quando um produto é vinculado ao catálogo. */
export function useAnuncioCanonico() {
  return useQuery<MapaCanonico>({
    queryKey: ['anuncio-canonico'],
    queryFn: buscarMapaCanonico,
    staleTime: 30 * 60_000,
  });
}
