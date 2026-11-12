// ADR-0204: proposta das fotos 2 a 7 do anúncio da base para o kit vinculado (edge `fotos-base-kit`, só leitura).
// Uma leitura por categoria (compartilhada entre os tamanhos); falha não bloqueia — a tela segue só com a capa.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { GaleriaProposta } from '@/lib/kit-galeria';

interface RespostaEdge { fotos: Array<{ id: string; item: string; url: string | null }>; avisos: string[]; indisponivel: boolean }

async function lerGaleriaBase(familiaBaseId: string, categoriaMlId: string | null): Promise<GaleriaProposta> {
  const { data, error } = await supabase.functions.invoke<RespostaEdge>('fotos-base-kit', {
    body: { familia_base_id: familiaBaseId, categoria_ml_id: categoriaMlId },
  });
  if (error || !data) throw error ?? new Error('Sem resposta de fotos-base-kit');
  return { avisos: data.avisos, indisponivel: data.indisponivel, fotos: data.fotos.map((f) => ({ ...f, cor: 'Base' })) };
}

export function useGaleriaBaseKit(familiaBaseId: string, categoriaMlId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ['galeria-base-kit', familiaBaseId, categoriaMlId],
    queryFn: () => lerGaleriaBase(familiaBaseId, categoriaMlId),
    enabled: ativo,
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
  });
}
