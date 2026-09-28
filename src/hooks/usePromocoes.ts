import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { emLeitura, fetchEstadoSyncPromocoes, fetchItensPromocao, fetchPromocoes, rotuloTipo } from '@/lib/promocoes';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';

const QK_PROMO = ['promocoes'] as const;

/** Enquanto alguma campanha está em leitura, recarrega a cada 10 s para a tela acompanhar. */
export function usePromocoes() {
  return useQuery({
    queryKey: [...QK_PROMO, 'lista'], queryFn: fetchPromocoes, staleTime: 60_000,
    refetchInterval: (q) => ((q.state.data ?? []).some((p) => emLeitura(p, Date.now())) ? 10_000 : false),
  });
}
export function useItensPromocao(promocaoId: string, lendo = false) {
  return useQuery({
    queryKey: [...QK_PROMO, 'itens', promocaoId], queryFn: () => fetchItensPromocao(promocaoId), staleTime: 60_000,
    refetchInterval: lendo ? 15_000 : false,
  });
}
export function useEstadoSyncPromocoes() {
  return useQuery({ queryKey: [...QK_PROMO, 'estado'], queryFn: fetchEstadoSyncPromocoes, staleTime: 30_000 });
}

/** Task 9 (ADR-0174 decisão 9): `ml_item_id -> nome da promoção` para quem está participando
 *  (`started`/`pending`) agora. Sem módulo Promoções ligado, não busca — é aviso, não fronteira de
 *  segurança, mas sem o módulo a org não tem `ml_promocao_itens` sincronizado mesmo.
 *  `ml_promocao_itens` não tem FK declarada para `ml_promocoes` (database.types.ts) — duas buscas,
 *  sem embed. */
export function useParticipacoesPorItem(mlItemIds: string[]) {
  const { data: modulosHabilitados } = useModulosHabilitados();
  const habilitado = !!modulosHabilitados?.includes('promocoes');
  const ids = [...new Set(mlItemIds)].sort();
  return useQuery({
    queryKey: [...QK_PROMO, 'participacoes', ids],
    enabled: habilitado && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: itens, error } = await supabase
        .from('ml_promocao_itens')
        .select('ml_item_id, promocao_id, status')
        .in('ml_item_id', ids)
        .in('status', ['started', 'pending']);
      if (error) throw error;
      const mapa = new Map<string, string>();
      const promocaoIds = [...new Set((itens ?? []).map((i) => i.promocao_id))];
      if (promocaoIds.length === 0) return mapa;
      const { data: promos, error: errPromo } = await supabase
        .from('ml_promocoes').select('promocao_id, nome, tipo').in('promocao_id', promocaoIds);
      if (errPromo) throw errPromo;
      const nomePorPromocao = new Map((promos ?? []).map((p) => [p.promocao_id, p.nome ?? rotuloTipo(p.tipo)]));
      for (const it of itens ?? []) {
        const nome = nomePorPromocao.get(it.promocao_id);
        if (nome) mapa.set(it.ml_item_id, nome);
      }
      return mapa;
    },
  });
}

/** MLBs de família User Products (ADR-0088): cada cor é um item ML próprio, gravado em
 *  `anuncios_externos_itens.item_externo_id` (mesma junção de `_shared/promocoes/cadastro.ts`).
 *  Família Legacy não entra aqui — usa `familia.mlItemId` direto. Chave do mapa: `codigoPai`. */
export function useItensUpPorCodigoPai(codigosPai: string[]) {
  const ids = [...new Set(codigosPai)].sort();
  return useQuery({
    queryKey: [...QK_PROMO, 'itens-up', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const porCodigo = new Map<string, string[]>();
      const { data: raizes, error } = await supabase
        .from('anuncios_externos')
        .select('id, codigo_pai')
        .eq('canal', 'mercado_livre')
        .in('codigo_pai', ids);
      if (error) throw error;
      const codigoPorRaiz = new Map((raizes ?? []).map((r) => [r.id, r.codigo_pai]));
      const rootIds = [...codigoPorRaiz.keys()];
      if (rootIds.length === 0) return porCodigo;
      const { data: itens, error: errItens } = await supabase
        .from('anuncios_externos_itens')
        .select('anuncio_externo_id, item_externo_id')
        .in('anuncio_externo_id', rootIds)
        .eq('retirado', false)
        .not('item_externo_id', 'is', null);
      if (errItens) throw errItens;
      for (const it of itens ?? []) {
        const codigo = codigoPorRaiz.get(it.anuncio_externo_id);
        if (!codigo || !it.item_externo_id) continue;
        porCodigo.set(codigo, [...(porCodigo.get(codigo) ?? []), it.item_externo_id]);
      }
      return porCodigo;
    },
  });
}

/** "Atualizar agora": o worker responde ao fim da etapa de lista (segundos); a leitura das campanhas
 *  segue em segundo plano e a lista acompanha por `rodada_em_curso`. 429 = atualizado há < 2 min. */
export function useAtualizarPromocoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sincronizar-promocoes', { body: {} });
      if (error) {
        const corpo = await (error as { context?: Response }).context?.json().catch(() => null);
        throw new Error((corpo as { erro?: string } | null)?.erro ?? 'Não foi possível atualizar as promoções.');
      }
      return data;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK_PROMO }),
  });
}
