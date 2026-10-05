import { useMemo } from 'react';
import { resolverJanela, janelaAnterior, type Janela, type Periodo } from '@/lib/metricas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useCoresProduto } from '@/hooks/useCoresProduto';
import { useAnuncioCanonico } from '@/hooks/useAnuncioCanonico';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { useDevolucoes } from '@/hooks/useDevolucoes';
import { useCatalogoVendasSku } from '@/hooks/useCatalogoVendasSku';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { montarFotoResolver } from '@/lib/fotos-produto';
import { montarCorResolver } from '@/lib/cor-produto';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import type { Venda } from '@/lib/faturamento';
import { janelaEstendida, montarVendasSku, type VendasSku } from '@/lib/vendas-sku';

/** Mesmos resolvers e mesma fonte da aba Vendas (aba-vendas.tsx:173-190): é isso que faz a soma bater. */
/** `janelaFixa`: janela ISO pronta (ex.: dias BRT do painel de Ads), no lugar de `resolverJanela(periodo)`. */
export function useVendasSku(periodo: Periodo, janelaFixa?: Janela, enabled = true) {
  const janela = useMemo(() => janelaFixa ?? resolverJanela(periodo), [periodo, janelaFixa]);
  const anterior = useMemo(() => janelaAnterior(janela, periodo), [janela, periodo]);
  const estendida = useMemo(() => janelaEstendida(janela, anterior), [janela, anterior]);
  const vendasQ = useVendas(estendida, 'todos', 'todos', enabled);
  const custosQ = useCustos();
  const custos = custosQ.data;
  const { data: fotos } = useFotosProduto();
  const { data: cores } = useCoresProduto();
  const { data: canonico } = useAnuncioCanonico();
  const { data: aliquotas } = useAliquotas();
  const devQ = useDevolucoes();
  const devolucoes = devQ.data;
  const catQ = useCatalogoVendasSku();

  const dados = useMemo<VendasSku | null>(() => {
    // Sem custos toda linha sairia "sem custo" por um instante: espera a query assentar.
    // Com erro nos custos calcula sem eles ("sem custo" é o honesto).
    // Sem devoluções a taxa sairia 0 (no load ou com a query em erro): espera — o erro vai em isError.
    if (!vendasQ.data || !catQ.data || (!custos && !custosQ.isError) || !devolucoes) return null;
    const custoR = montarCustoResolver(custos);
    const pesoR = montarPesoResolver(custos);
    const fotoR = montarFotoResolver(fotos, canonico);
    const aliqR = montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 });
    const corR = montarCorResolver(cores, canonico);
    return montarVendasSku({
      vendas: vendasQ.data,
      agrupar: (vs: Venda[]) => agruparPorPedido(vs, custoR, pesoR, fotoR, aliqR, corR),
      janela, anterior,
      catalogo: new Map(catQ.data.map((c) => [c.codigo, c])),
      devolucoes,
    });
  }, [vendasQ.data, catQ.data, custos, custosQ.isError, fotos, cores, canonico, aliquotas, devolucoes, janela, anterior]);

  return {
    dados,
    isLoading: vendasQ.isLoading || catQ.isLoading || custosQ.isLoading || devQ.isLoading,
    isFetching: vendasQ.isFetching || catQ.isFetching,
    /** Sem isso a tela ficaria em skeleton para sempre quando vendas, catálogo ou devoluções falham. */
    isError: vendasQ.isError || catQ.isError || devQ.isError,
    refetch: () => Promise.all([vendasQ.refetch(), catQ.refetch(), devQ.refetch()]),
  };
}
