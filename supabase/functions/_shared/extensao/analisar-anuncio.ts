// Orquestração da análise de um anúncio na Extensão PubliAI (ADR-0189 D-5/D-7/D-8).
// Lógica pura com deps injetadas; a edge implementa as consultas ao banco e ao ML.
import type { DimensoesPacote } from '../ml/pacote.ts';
import { calcularMinhaMargem, custoDoPacote, fatorDoPacote } from './margem.ts';
import type { ComissaoML, Disponivel, MinhaMargem } from './tipos.ts';
import { resolverVinculo, type DepsVinculo, type FonteCusto, type VariacaoCusto } from './vinculo.ts';

export interface EntradaAnuncio {
  mlItemId: string;
  sellerId: string;
  catalogProductId: string | null;
  categoriaId: string;
  preco: number;
  eanDaBusca: string | null;
}

export interface DepsAnuncio extends DepsVinculo {
  /** seller id da conexão ML da organização, ou null. */
  contaDaOrg(orgId: string): Promise<string | null>;
  aliquotas(orgId: string): Promise<{ confirmada: boolean; nacional: number | null; importado: number | null }>;
  comissao(preco: number, categoriaId: string, tipo: 'gold_special' | 'gold_pro'): Promise<Disponivel<ComissaoML>>;
  /** 'partial' do ML → ok + aviso. */
  frete(preco: number, categoriaId: string, dim: DimensoesPacote | null): Promise<Disponivel<number>>;
  /** UNITS_PER_PACK de /products/{id}. Sem catálogo, sem o atributo ou falha de leitura → indisponível (nunca 1). */
  unidadesPorPacote(catalogProductId: string | null): Promise<Disponivel<number>>;
  /** Dimensões próprias do kit vinculado da família `codigoPai` com `fator` SKUs; null se não há. */
  dimensoesDoPacote(orgId: string, codigoPai: string, fator: number): Promise<DimensoesPacote | null>;
}

export interface RespostaAnuncio {
  proprio: boolean;
  margem: MinhaMargem | null;
  custo: {
    fonte: FonteCusto;
    codigo: string | null;
    origem: 'nacional' | 'importado' | null;
    /** Unidades do anúncio (UNITS_PER_PACK do catálogo); null = não confirmadas — o painel pede ao operador. */
    unidadesPorPacote: number | null;
    /** UNITS_PER_PACK do próprio SKU; null = não confirmado. */
    unidadesSku: number | null;
    custoSku: number | null;
    /** SKUs por anúncio; null = composição não confirmada ou diferente. */
    fator: number | null;
    /** Lado cujas unidades não estão confirmadas (o painel pede ao operador, sem padrão); null = nenhum. */
    faltaUnidades: 'anuncio' | 'sku' | 'ambos' | null;
    custoPacote: Disponivel<number> | null;
  };
  /** Para o painel simular outro preço/custo sem nova ida ao ML. */
  parametros: {
    aliquotas: { nacional: number | null; importado: number | null; confirmada: boolean };
    classico: Disponivel<ComissaoML>;
    premium: Disponivel<ComissaoML>;
    frete: Disponivel<number>;
  };
}

const FALHA_ML = { estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' } as const;
const UPP_INDISPONIVEL = { estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' } as const;
export const FRETE_ESTIMADO = 'estimado (pacote padrão)';

/** Exceção de dep do ML nunca vira zero (D-7). */
function semExcecao<T>(f: () => Promise<Disponivel<T>>): Promise<Disponivel<T>> {
  return Promise.resolve().then(f).catch(() => FALHA_ML);
}

export async function analisarAnuncio(orgId: string, e: EntradaAnuncio, deps: DepsAnuncio): Promise<RespostaAnuncio> {
  const conta = await deps.contaDaOrg(orgId);
  if (conta != null && String(e.sellerId) === conta) {
    const proprio = { estado: 'indisponivel', motivo: 'anúncio próprio' } as const;
    return {
      proprio: true,
      margem: null,
      custo: { fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: null, unidadesSku: null, custoSku: null, fator: null, faltaUnidades: null, custoPacote: null },
      parametros: { aliquotas: { nacional: null, importado: null, confirmada: false }, classico: proprio, premium: proprio, frete: proprio },
    };
  }

  const [{ fonte, variacao }, aliquotas, unidades] = await Promise.all([
    resolverVinculo(orgId, e, deps),
    deps.aliquotas(orgId),
    deps.unidadesPorPacote(e.catalogProductId).catch((): Disponivel<number> => UPP_INDISPONIVEL),
  ]);
  const unidadesAnuncio = unidades.estado === 'ok' ? unidades.valor : null;
  // Mesmo produto do catálogo = mesma composição: fator 1 por identidade, sem depender de UNITS_PER_PACK.
  const composicao: Disponivel<number> | null = !variacao ? null
    : fonte === 'catalogo' ? { estado: 'ok', valor: 1 } : fatorDoPacote(unidadesAnuncio, variacao.unidades);
  const fator = composicao?.estado === 'ok' ? composicao.valor : null;
  const semAnuncio = unidadesAnuncio === null;
  const semSku = variacao?.unidades == null;
  const faltaUnidades = !variacao || fonte === 'catalogo' ? null
    : semAnuncio && semSku ? 'ambos' : semAnuncio ? 'anuncio' : semSku ? 'sku' : null;
  const dims = await dimensoesDoFrete(orgId, variacao, fator, deps);
  const [classico, premium, freteML] = await Promise.all([
    semExcecao(() => deps.comissao(e.preco, e.categoriaId, 'gold_special')),
    semExcecao(() => deps.comissao(e.preco, e.categoriaId, 'gold_pro')),
    semExcecao(() => deps.frete(e.preco, e.categoriaId, dims)),
  ]);
  // Oficial só com fator 1 (o anúncio entrega exatamente o SKU analisado) e as dimensões desse SKU; qualquer
  // outro caso — inclusive kit de N com dimensões próprias — é estimativa rotulada (D-7).
  const oficial = fator === 1 && dims !== null;
  const frete: Disponivel<number> = !oficial && freteML.estado === 'ok' ? { ...freteML, aviso: FRETE_ESTIMADO } : freteML;

  // Origem nunca presumida (D-8): sem variação, o painel recalcula com a escolha do operador.
  let aliquotaPct: Disponivel<number>;
  if (!aliquotas.confirmada) {
    aliquotaPct = { estado: 'indisponivel', motivo: 'Confirme as alíquotas de imposto em Configurações' };
  } else if (!variacao) {
    aliquotaPct = { estado: 'indisponivel', motivo: 'Informe a origem do produto' };
  } else if (variacao.origem === null) {
    aliquotaPct = { estado: 'indisponivel', motivo: 'SKU sem origem cadastrada' };
  } else {
    aliquotaPct = { estado: 'ok', valor: variacao.origem === 'importado' ? aliquotas.importado ?? 16 : aliquotas.nacional ?? 8 };
  }

  // Composição nunca presumida (D-8): quantidade do anúncio desconhecida → o motivo dela (o painel pede ao operador).
  const custoPacote = !variacao || !composicao ? null
    : faltaUnidades === 'anuncio' && unidades.estado === 'indisponivel' && variacao.custo != null ? unidades
    : custoDoPacote(variacao.custo, composicao);
  const margem = calcularMinhaMargem({
    preco: e.preco,
    aliquotaPct,
    custoPacote,
    classico: { comissao: classico, frete },
    premium: { comissao: premium, frete },
  });

  return {
    proprio: false,
    margem,
    custo: {
      fonte, codigo: variacao?.codigo ?? null, origem: variacao?.origem ?? null,
      unidadesPorPacote: unidadesAnuncio, unidadesSku: variacao?.unidades ?? null, custoSku: variacao?.custo ?? null, fator, faltaUnidades, custoPacote,
    },
    parametros: { aliquotas, classico, premium, frete },
  };
}

/** Embalagem do que o anúncio entrega: 1 SKU → dimensões do SKU; N SKUs → dimensões próprias do kit vinculado
 *  vivo de N, se houver (melhora a estimativa, que segue rotulada); composição desconhecida → null (pacote padrão). */
async function dimensoesDoFrete(orgId: string, v: VariacaoCusto | null, fator: number | null, deps: DepsAnuncio): Promise<DimensoesPacote | null> {
  if (!v || fator === null) return null;
  if (fator === 1) return v.dimensoes;
  if (!v.codigoPai) return null;
  return await deps.dimensoesDoPacote(orgId, v.codigoPai, fator).catch(() => null);
}
