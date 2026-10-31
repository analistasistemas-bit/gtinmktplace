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
import { calcularKpis, type Venda } from '@/lib/faturamento';
import { ehFaturavel, type AliquotaResolver, type CustoResolver } from '@/lib/resumo-vendas';
import { dentroDaJanela, janelaEstendida, montarVendasSku, SEM_CODIGO, type BaseFiscal, type VendasSku } from '@/lib/vendas-sku';
export type { BaseFiscal };
import type { CanalAtivo } from '@/lib/canal-ativo';

export interface OpcoesVendasSku {
  /** Canal das vendas. Default 'todos' (Faturamento, dossiê); o /ads pede 'mercado_livre'. */
  canal?: CanalAtivo;
  /** Janela anterior exata (ex.: dias BRT da comparação do /ads). Sem ela, `faturamentoConta.anterior` é null. */
  anteriorFixa?: Janela;
}

/** Mesmo recorte de `impostoDoItem` em agruparPorPedido: item faturável da venda, UF da venda. Relevante =
 *  entra no lucro (custo > 0, como custoDoItem). Só as janelas atual e anterior; as de tendência não têm dinheiro. */
function origemNaoResolvida(vendas: Venda[], janelas: Janela[], custoR: CustoResolver, aliqR: AliquotaResolver): string[] {
  const codigos = new Set<string>();
  for (const v of vendas) {
    if (!ehFaturavel(v.status) || !janelas.some((j) => dentroDaJanela(v.date_closed, j))) continue;
    for (const it of v.itens) {
      if ((custoR(it) ?? 0) > 0 && aliqR(it, v.uf) == null) codigos.add(it.codigo?.trim() || SEM_CODIGO);
    }
  }
  return [...codigos].sort();
}

/** Faturamento da conta (denominador do TACOS, plano §2.3): toda venda faturável do recorte, uma vez cada,
 *  por `brutoDaVenda` (cupom do vendedor descontado, ADR-0180) — inclusive fora do catálogo PubliAI.
 *  Reusa `calcularKpis`, o mesmo número do card Faturamento. */
const faturamentoDa = (vendas: Venda[], j: Janela) =>
  calcularKpis(vendas.filter((v) => dentroDaJanela(v.date_closed, j))).faturamento;

/** Mesmos resolvers e mesma fonte da aba Vendas (aba-vendas.tsx:173-190): é isso que faz a soma bater. */
/** `janelaFixa`: janela ISO pronta (ex.: dias BRT do painel de Ads), no lugar de `resolverJanela(periodo)`. */
export function useVendasSku(periodo: Periodo, janelaFixa?: Janela, enabled = true, opcoes: OpcoesVendasSku = {}) {
  const { canal = 'todos', anteriorFixa } = opcoes;
  const janela = useMemo(() => janelaFixa ?? resolverJanela(periodo), [periodo, janelaFixa]);
  const anterior = useMemo(() => anteriorFixa ?? janelaAnterior(janela, periodo), [anteriorFixa, janela, periodo]);
  const estendida = useMemo(() => janelaEstendida(janela, anterior), [janela, anterior]);
  const vendasQ = useVendas(estendida, 'todos', canal, enabled);
  const custosQ = useCustos();
  const custos = custosQ.data;
  const { data: fotos } = useFotosProduto();
  const { data: cores } = useCoresProduto();
  const { data: canonico } = useAnuncioCanonico();
  const aliqQ = useAliquotas();
  const aliquotas = aliqQ.data;
  const devQ = useDevolucoes();
  const devolucoes = devQ.data;
  // Catálogo é base de vendas, não só agrupamento: `historicoDesde` (primeira venda da org) sai dele, e sem
  // histórico cobrindo a janela o lucro é desconhecido (historicoCobre). Por isso `dados` espera o catálogo.
  const catQ = useCatalogoVendasSku();

  const calculo = useMemo<{ dados: VendasSku; baseFiscal: BaseFiscal } | null>(() => {
    // Sem custos toda linha sairia "sem custo" por um instante: espera a query assentar.
    // Com erro nos custos calcula sem eles ("sem custo" é o honesto).
    // Sem devoluções a taxa sairia 0 (no load ou com a query em erro): espera — o erro vai em isError.
    if (!vendasQ.data || !catQ.data || (!custos && !custosQ.isError) || !devolucoes) return null;
    const custoR = montarCustoResolver(custos);
    const pesoR = montarPesoResolver(custos);
    const fotoR = montarFotoResolver(fotos, canonico);
    // Fallback 8/16 mantido para Faturamento/dossiê; o /ads lê `baseFiscal`, que acusa esse fallback.
    const aliqR = montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 });
    const corR = montarCorResolver(cores, canonico);
    // Erro antes de "carregando": refetch com falha mantém data antiga, mas a base não está garantida.
    let baseFiscal: BaseFiscal;
    if (aliqQ.isError) baseFiscal = { ok: false, motivo: 'aliquotas_erro' };
    else if (!aliquotas) baseFiscal = { ok: false, motivo: 'aliquotas_carregando' };
    else if (!aliquotas.confirmada) baseFiscal = { ok: false, motivo: 'aliquotas_nao_confirmadas' };
    else {
      const codigos = origemNaoResolvida(vendasQ.data, [janela, anterior], custoR, aliqR);
      baseFiscal = codigos.length ? { ok: false, motivo: 'origem_nao_resolvida', codigos } : { ok: true };
    }
    const dados = montarVendasSku({
      vendas: vendasQ.data,
      agrupar: (vs: Venda[]) => agruparPorPedido(vs, custoR, pesoR, fotoR, aliqR, corR),
      janela, anterior,
      catalogo: new Map(catQ.data.map((c) => [c.codigo, c])),
      devolucoes,
    });
    return { dados, baseFiscal };
  }, [vendasQ.data, catQ.data, custos, custosQ.isError, fotos, cores, canonico, aliquotas, aliqQ.isError, devolucoes, janela, anterior]);

  // Só depende das vendas: catálogo/custos não entram no denominador do TACOS.
  const faturamentoConta = useMemo(() => {
    if (!vendasQ.data) return null;
    return {
      atual: faturamentoDa(vendasQ.data, janela),
      anterior: anteriorFixa ? faturamentoDa(vendasQ.data, anteriorFixa) : null,
    };
  }, [vendasQ.data, janela, anteriorFixa]);

  return {
    dados: calculo?.dados ?? null,
    /** null enquanto `dados` não monta. */
    baseFiscal: calculo?.baseFiscal ?? null,
    faturamentoConta,
    isLoading: vendasQ.isLoading || catQ.isLoading || custosQ.isLoading || devQ.isLoading,
    isFetching: vendasQ.isFetching || catQ.isFetching,
    /** Sem isso a tela ficaria em skeleton para sempre quando vendas, catálogo ou devoluções falham. */
    isError: vendasQ.isError || catQ.isError || devQ.isError,
    /** Origem do erro: o /ads separa catálogo (bloco) de vendas/devoluções (geral). */
    erros: { vendas: vendasQ.isError, catalogo: catQ.isError, devolucoes: devQ.isError },
    refetch: () => Promise.all([vendasQ.refetch(), catQ.refetch(), devQ.refetch()]),
  };
}
