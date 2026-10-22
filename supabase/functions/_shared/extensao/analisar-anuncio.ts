// Orquestração da análise de um anúncio na Extensão PubliAI (ADR-0189 D-5/D-7/D-8).
// Lógica pura com deps injetadas; a edge implementa as consultas ao banco e ao ML.
import type { DimensoesPacote } from '../ml/pacote.ts';
import { calcularMinhaMargem } from './margem.ts';
import type { ComissaoML, Disponivel, MinhaMargem } from './tipos.ts';
import { custoDoPacote, resolverVinculo, type DepsVinculo, type FonteCusto } from './vinculo.ts';

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
  /** UNITS_PER_PACK de /products/{id}; padrão 1. */
  unidadesPorPacote(catalogProductId: string | null): Promise<number>;
}

export interface RespostaAnuncio {
  proprio: boolean;
  margem: MinhaMargem | null;
  custo: {
    fonte: FonteCusto;
    codigo: string | null;
    origem: 'nacional' | 'importado' | null;
    unidadesPorPacote: number;
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
      custo: { fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: 1, custoPacote: null },
      parametros: { aliquotas: { nacional: null, importado: null, confirmada: false }, classico: proprio, premium: proprio, frete: proprio },
    };
  }

  const [{ fonte, variacao }, aliquotas, unidades] = await Promise.all([
    resolverVinculo(orgId, e, deps),
    deps.aliquotas(orgId),
    deps.unidadesPorPacote(e.catalogProductId),
  ]);
  const [classico, premium, frete] = await Promise.all([
    semExcecao(() => deps.comissao(e.preco, e.categoriaId, 'gold_special')),
    semExcecao(() => deps.comissao(e.preco, e.categoriaId, 'gold_pro')),
    semExcecao(() => deps.frete(e.preco, e.categoriaId, variacao?.dimensoes ?? null)),
  ]);

  // Origem nunca presumida (D-8): sem variação, o painel recalcula com a escolha do operador.
  let aliquotaPct: Disponivel<number>;
  if (!aliquotas.confirmada) {
    aliquotaPct = { estado: 'indisponivel', motivo: 'Confirme as alíquotas de imposto em Configurações' };
  } else if (!variacao) {
    aliquotaPct = { estado: 'indisponivel', motivo: 'Informe a origem do produto' };
  } else {
    aliquotaPct = { estado: 'ok', valor: variacao.origem === 'importado' ? aliquotas.importado ?? 16 : aliquotas.nacional ?? 8 };
  }

  const custoPacote = variacao ? custoDoPacote(variacao, unidades) : null;
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
    custo: { fonte, codigo: variacao?.codigo ?? null, origem: variacao?.origem ?? null, unidadesPorPacote: unidades, custoPacote },
    parametros: { aliquotas, classico, premium, frete },
  };
}
