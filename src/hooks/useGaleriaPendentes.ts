import { useQuery } from '@tanstack/react-query';
import { listarPendentes, type PendenteGaleria } from '@/lib/galeria/api';

/** Imagens da galeria prontas e ainda não aplicadas. `enabled` = a org tem o módulo `imagem_ia`. */
export function useGaleriaPendentes(enabled = true) {
  return useQuery<PendenteGaleria[]>({
    queryKey: ['galeria-pendentes'],
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const r = await listarPendentes();
      if (!r.ok) throw new Error(r.erro);
      return r.dados.pendentes;
    },
  });
}
