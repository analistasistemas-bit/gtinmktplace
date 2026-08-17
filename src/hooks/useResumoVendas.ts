import { useMemo } from 'react';
import { useVendas } from './useVendas';
import { useCustos } from './useCustos';
import { useAnuncioCanonico } from './useAnuncioCanonico';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { calcularResumo, type ResumoVendas } from '@/lib/resumo-vendas';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import type { Janela } from '@/lib/metricas';
import type { CanalAtivo } from '@/lib/canal-ativo';

/**
 * Resumo financeiro do período a partir da tabela ml_vendas (fonte única — ADR-0038). Os menus
 * Faturamento, Financeiro e Publicados consomem isto, então mostram o mesmo número.
 */
export function useResumoVendas(janela: Janela, canal: CanalAtivo = 'todos'): {
  resumo: ResumoVendas;
  isFetching: boolean;
  refetch: () => void;
  error: boolean;
  dataUpdatedAt: number;
  /** O mapa canônico já assentou (sucesso ou erro)? Só `resumo.porItem` depende dele — enquanto
   *  for false, as vendas do anúncio de catálogo ainda estão na chave do MLB de catálogo, não na
   *  do anúncio dono. Quem exibe vendas POR ANÚNCIO deve segurar até aqui virar true, senão a
   *  linha mostra um parcial e depois salta (ver Publicados.tsx). Os KPIs agregados (bruto,
   *  líquido, unidades, pedidos) NÃO dependem do mapa — a canonização só muda em que chave as
   *  unidades caem — então não devem ser segurados por isto. */
  canonicoPronto: boolean;
} {
  const vendasQ = useVendas(janela, 'todos', canal);
  const custosQ = useCustos();
  const aliquotasQ = useAliquotas();
  // Vendas que entraram por um MLB que a tela não lista — anúncio de catálogo (ADR-0021/0045) ou
  // anúncio irmão legado (mesmo produto publicado no ML como N anúncios) — somam no anúncio dono.
  // Sem o mapa, essas unidades somem da linha do produto em Publicados.
  const canonicoQ = useAnuncioCanonico();
  // Default 8/16 só cobre o loading inicial (data ainda undefined, sem erro). Em erro real de
  // aliquotasQ, `data` fica undefined (1ª carga) ou mantém o último valor bom (TanStack Query não
  // limpa data em refetch com erro) — nos dois casos NÃO aproximamos com 8/16: sem config
  // resolvida, o resolver de alíquota devolve null (sem imposto) em vez de um número possivelmente
  // errado (ADR-0055: imposto por origem nunca defaulta em silêncio).
  const aliquotas = useMemo(
    () => aliquotasQ.data ?? (aliquotasQ.isError ? null : { nacional: 8, importado: 16 }),
    [aliquotasQ.data, aliquotasQ.isError],
  );
  const resumo = useMemo(
    () => calcularResumo(
      vendasQ.data ?? [],
      montarCustoResolver(custosQ.data),
      montarPesoResolver(custosQ.data),
      undefined,
      montarAliquotaResolver(custosQ.data, aliquotas),
      canonicoQ.data,
    ),
    [vendasQ.data, custosQ.data, aliquotas, canonicoQ.data],
  );
  return {
    resumo,
    isFetching: vendasQ.isFetching,
    refetch: () => { vendasQ.refetch(); },
    error: vendasQ.isError || custosQ.isError || aliquotasQ.isError,
    dataUpdatedAt: vendasQ.dataUpdatedAt,
    // isError conta como assentado: sem o mapa, `porItem` volta ao comportamento de antes (vendas
    // de catálogo na chave do MLB de catálogo) em vez de a coluna ficar "—" para sempre.
    canonicoPronto: canonicoQ.isSuccess || canonicoQ.isError,
  };
}
