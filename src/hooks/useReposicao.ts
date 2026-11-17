// ADR-0207 — Reposição: leitura da edge `reposicao` (GET) e as ações (POST), mais a visão pura
// que a tela de Sugestões consome (cards, lista por família, mapa da grade).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionRegion } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { montarPedidosAbertos, type PedidoAberto, type SugestaoSku, type TendenciaFamilia, type Urgencia } from '../../supabase/functions/_shared/reposicao/calculo';
import type { FamiliaTela, NaoReporDTO, RespostaReposicao, SkuTela } from '../../supabase/functions/_shared/reposicao/tipos';

export const QK_REPOSICAO = ['reposicao'] as const;

const SEM_SERVIDOR = 'Não foi possível falar com o servidor. Confira a conexão e tente de novo.';

/** A edge devolve `{ error }` (não `erro`, como operacoes-massa). Falha de rede (`FunctionsFetchError`)
 *  não traz Response: cai na mensagem própria, nunca no texto cru em inglês do supabase-js. */
async function lerErro(error: unknown): Promise<Error> {
  const ctx = (error as { context?: unknown }).context as { json?: () => Promise<unknown> } | undefined;
  if (typeof ctx?.json === 'function') {
    try {
      const msg = ((await ctx.json()) as { error?: unknown } | null)?.error;
      if (typeof msg === 'string' && msg) return new Error(msg);
    } catch { /* corpo não-JSON: mensagem padrão */ }
  }
  return new Error(SEM_SERVIDOR);
}

async function chamar<T>(body?: Record<string, unknown>): Promise<T> {
  // us-east-1: perto do banco (mesmo motivo de platform-admin.ts).
  const { data, error } = await supabase.functions.invoke<T>('reposicao', body
    ? { body, region: FunctionRegion.UsEast1 }
    : { method: 'GET', region: FunctionRegion.UsEast1 });
  if (error) throw await lerErro(error);
  return data as T;
}

export interface ItemRascunho { codigo: string; codigoPai: string; quantidade: number; sugerida?: number | null }

/** `enabled: false` = não busca (diálogos do Estoque, só com o módulo `reposicao` e abertos).
 *  `staleTime`: o Estoque usa 5 min (selo indicativo, sem refazer o cálculo a cada visita). */
export function useReposicao(opts: { enabled?: boolean; staleTime?: number } = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: QK_REPOSICAO, queryFn: () => chamar<RespostaReposicao>(), staleTime: opts.staleTime ?? 60_000, enabled: opts.enabled ?? true,
  });
  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) => chamar<Record<string, unknown>>(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_REPOSICAO }),
  });
  const acao = (action: string) => (p: Record<string, unknown> = {}) => mut.mutateAsync({ action, ...p });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    pendente: mut.isPending,
    salvarConfig: (p: { prazo: number; cobertura: number }) => acao('salvar_config')(p),
    salvarRascunho: (p: { fornecedorNome: string; itens: ItemRascunho[]; pedidoId?: string; previstoPara?: string | null }) => acao('salvar_rascunho')(p),
    // `ref` obrigatória, gerada UMA vez por submissão pelo chamador e reaproveitada em retentativa e
    // duplo clique: com a mesma ref a edge devolve `jaAprovado` em vez de 409.
    aprovar: (p: { pedidoId: string; ref: string }) => acao('aprovar')(p),
    marcarEnviado: (p: { pedidoId: string }) => acao('marcar_enviado')(p),
    editarPedido: (p: { pedidoId: string; previstoPara: string; itens: { codigo: string; quantidade: number }[] }) => acao('editar_pedido')(p),
    encerrarSaldo: (p: { pedidoId: string; codigos?: string[] }) => acao('encerrar_saldo')(p),
    reabrirSaldo: (p: { pedidoId: string; codigos?: string[] }) => acao('reabrir_saldo')(p),
    naoRepor: (p: { escopo: 'sku' | 'cor' | 'familia'; codigoPai: string; codigo?: string; cor?: string }) => acao('nao_repor')(p),
    removerNaoRepor: (id: string) => acao('remover_nao_repor')({ id }),
    // Só o Estoque marca "fora de linha" (produto ou cor); tira dos rascunhos os itens afetados.
    foraDeLinha: (p: { escopo: 'familia' | 'cor'; codigoPai: string; cor?: string }) => acao('fora_de_linha')(p),
    definirMultiplo: (p: { codigoPai: string; multiplo: number }) => acao('definir_multiplo')(p),
  };
}

/** Selo do card do Estoque (Task 8). */
export function urgenciaDoProduto(data: RespostaReposicao | undefined, codigoPai: string): Urgencia | null {
  return data?.resultado?.familias.find((f) => f.codigoPai === codigoPai)?.urgencia ?? null;
}

/** Fora de linha de um produto (Estoque): marca de família, cores com a marca de escopo `cor` e quanto do
 *  rascunho a marcação tiraria. null = produto fora da resposta. */
export function foraDeLinhaDoProduto(data: RespostaReposicao | undefined, codigoPai: string) {
  if (!data?.familias.some((f) => f.codigoPai === codigoPai)) return null;
  const skus = data.skus.filter((s) => s.codigoPai === codigoPai);
  const marcas = data.naoRepor.filter((n) => n.codigoPai === codigoPai);
  const cores: { cor: string; corHex: string | null; marcaId: string | null }[] = [];
  for (const s of skus) {
    if (!s.cor || cores.some((c) => c.cor === s.cor)) continue;
    cores.push({ cor: s.cor, corHex: s.corHex, marcaId: marcas.find((n) => n.escopo === 'cor' && n.cor === s.cor)?.id ?? null });
  }
  const corPor = new Map(skus.map((s) => [s.codigo, s.cor]));
  return {
    familiaId: marcas.find((n) => n.escopo === 'familia')?.id ?? null,
    cores,
    rascunho: (escopo: 'familia' | 'cor', cor?: string) => {
      let unidades = 0; let rascunhos = 0;
      for (const r of data.rascunhos) {
        const afetados = r.itens.filter((i) => i.codigoPai === codigoPai && (escopo === 'familia' || corPor.get(i.codigo) === cor));
        if (!afetados.length) continue;
        rascunhos += 1;
        unidades += afetados.reduce((a, i) => a + i.quantidade, 0);
      }
      return { unidades, rascunhos };
    },
  };
}

// ---------- visão da tela (pura) ----------

export interface SkuVisao {
  tela: SkuTela; sug: SugestaoSku; pedidos: PedidoAberto[];
  /** Urgência na TELA: SKU em Não repor sai das faixas (vira 'em_dia'); o mapa o mostra riscado. */
  urgencia: Urgencia;
  /** Escopo do Não repor que vale para o SKU (o mais específico, como em dados.ts). */
  naoReporEscopo: NaoReporDTO['escopo'] | null;
}
export interface FamiliaVisao {
  codigoPai: string; nome: string; fornecedor: FamiliaTela['fornecedor']; multiplo: number;
  urgencia: Urgencia; tendencia: TendenciaFamilia | null; pedir: number; pedirAntesMultiplo: number;
  /** R$ da sugestão pelo custo (SKU sem custo conta 0). */
  valor: number;
  /** Σ v × preço dos SKUs em ruptura. */
  vendaPerdidaDia: number;
  /** Menor dia em que a projeção zera entre os SKUs que vendem; null = não zera no horizonte. */
  diasDeEstoque: number | null;
  aCaminho: number; chegaEm: string | null;
  /** Tem cor e/ou tamanho: mostra o mapa da grade. */
  temGrade: boolean;
  skus: SkuVisao[];
  naoReporFamiliaId: string | null;
}
export interface CardFaixa { skus: number; produtos: number }
export interface Visao {
  familias: FamiliaVisao[];
  cards: Record<'ruptura' | 'vai_faltar' | 'pedir_agora', CardFaixa> & {
    vendaPerdidaDia: number; sugerido: { valor: number; unidades: number; fornecedores: number };
  };
  /** Fração estimada pela família quando passa de 0,5 (aviso da loja); senão null. */
  avisoLoja: number | null;
  semVendas: boolean;
  fornecedores: string[];
}

export const ORDEM_URGENCIA: Urgencia[] = ['ruptura', 'vai_faltar', 'pedir_agora', 'em_dia'];

export function montarVisao(data: RespostaReposicao, hoje: string): Visao {
  const r = data.resultado!;
  const telaPor = new Map(data.skus.map((s) => [s.codigo, s]));
  const famPor = new Map(data.familias.map((f) => [f.codigoPai, f]));
  const abertos = montarPedidosAbertos(data.pedidos, hoje);
  const escopoPor = new Map(data.naoRepor.map((n) => [n.id, n.escopo]));
  const skusPor = new Map<string, SkuVisao[]>();
  for (const sug of r.skus) {
    const t = telaPor.get(sug.codigo);
    if (!t) continue; // kit: não aparece na tela
    const lista = skusPor.get(sug.codigoPai) ?? [];
    lista.push({
      tela: t, sug, pedidos: abertos.filter((o) => o.codigo === sug.codigo), urgencia: t.naoReporId ? 'em_dia' : sug.urgencia,
      naoReporEscopo: t.naoReporId ? escopoPor.get(t.naoReporId) ?? null : null,
    });
    skusPor.set(sug.codigoPai, lista);
  }

  const familias: FamiliaVisao[] = r.familias.flatMap((rf) => {
    const f = famPor.get(rf.codigoPai);
    const skus = skusPor.get(rf.codigoPai) ?? [];
    if (!f || !skus.length) return [];
    const dias = skus.filter((s) => s.sug.v > 0 && s.sug.diasDeEstoque !== null).map((s) => s.sug.diasDeEstoque!);
    const ruptura = skus.filter((s) => s.urgencia === 'ruptura');
    // "chega dd/mm" acompanha a pill de Ruptura: só a chegada dos SKUs em ruptura.
    const chegadas = ruptura.map((s) => s.sug.chegaEm).filter((d): d is string => !!d).sort();
    return [{
      codigoPai: rf.codigoPai, nome: f.nome, fornecedor: f.fornecedor, multiplo: f.multiplo,
      urgencia: ORDEM_URGENCIA.find((u) => skus.some((s) => s.urgencia === u)) ?? 'em_dia', tendencia: rf.tendencia, pedir: rf.pedir, pedirAntesMultiplo: rf.pedirAntesMultiplo,
      valor: skus.reduce((a, s) => a + s.sug.pedir * (s.tela.custo ?? 0), 0),
      vendaPerdidaDia: ruptura.reduce((a, s) => a + s.sug.v * (s.tela.preco ?? 0), 0),
      diasDeEstoque: dias.length ? Math.min(...dias) : null,
      aCaminho: skus.reduce((a, s) => a + s.sug.aCaminho, 0),
      chegaEm: chegadas[0] ?? null,
      temGrade: skus.some((s) => s.tela.cor || s.tela.tamanho),
      skus,
      naoReporFamiliaId: data.naoRepor.find((n) => n.escopo === 'familia' && n.codigoPai === rf.codigoPai)?.id ?? null,
    }];
  });
  familias.sort((a, b) => ORDEM_URGENCIA.indexOf(a.urgencia) - ORDEM_URGENCIA.indexOf(b.urgencia)
    || b.vendaPerdidaDia - a.vendaPerdidaDia || b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));

  const faixa = (u: Urgencia): CardFaixa => ({
    skus: familias.reduce((a, f) => a + f.skus.filter((s) => s.urgencia === u).length, 0),
    produtos: familias.filter((f) => f.skus.some((s) => s.urgencia === u)).length,
  });
  const comprar = familias.filter((f) => f.pedir > 0);
  return {
    familias,
    cards: {
      ruptura: faixa('ruptura'), vai_faltar: faixa('vai_faltar'), pedir_agora: faixa('pedir_agora'),
      vendaPerdidaDia: familias.reduce((a, f) => a + f.vendaPerdidaDia, 0),
      sugerido: {
        valor: comprar.reduce((a, f) => a + f.valor, 0),
        unidades: comprar.reduce((a, f) => a + f.pedir, 0),
        fornecedores: new Set(comprar.map((f) => f.fornecedor.nome.trim()).filter(Boolean)).size,
      },
    },
    avisoLoja: r.pctEstimadoPelaFamilia > 0.5 ? r.pctEstimadoPelaFamilia : null,
    semVendas: !r.skus.some((s) => s.unidades > 0),
    fornecedores: [...new Set(familias.map((f) => f.fornecedor.nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

/** Cores (texto exato) com todos os SKUs marcados: a linha da cor está fora de linha (marca de cor ou de cada tamanho). */
export function coresForaDeLinha(f: FamiliaVisao): Set<string> {
  const cores = new Set(f.skus.map((s) => s.tela.cor).filter((c): c is string => !!c));
  return new Set([...cores].filter((c) => f.skus.filter((s) => s.tela.cor === c).every((s) => !!s.tela.naoReporId)));
}
/** Escondida por padrão na Reposição: marca de produto, ou nenhuma linha de cor visível. */
export function familiaForaDeLinha(f: FamiliaVisao): boolean {
  if (f.naoReporFamiliaId) return true;
  const fora = coresForaDeLinha(f);
  return fora.size > 0 && f.skus.every((s) => !!s.tela.cor && fora.has(s.tela.cor));
}

/** Filtro da lista. Card e filtro usam a MESMA regra (família com ≥ 1 SKU na faixa), senão o número não bate com a lista. */
export type FiltroUrgencia = 'precisa' | 'ruptura' | 'vai_faltar' | 'pedir_agora' | 'em_dia' | 'comprar';
export function passaUrgencia(f: FamiliaVisao, filtro: FiltroUrgencia): boolean {
  switch (filtro) {
    case 'precisa': return f.urgencia !== 'em_dia' || f.pedir > 0;
    case 'comprar': return f.pedir > 0;
    case 'em_dia': return f.urgencia === 'em_dia';
    default: return f.skus.some((s) => s.urgencia === filtro);
  }
}
