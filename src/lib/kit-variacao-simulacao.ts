// ADR-0200: simulador de lucro do kit com variação, antes de confirmar. Nenhuma fórmula nova: comissão,
// frete e imposto vêm de `calcularTarifaML` (recebe já líquido), lucro e markup de `calcularMarkup`, e a
// margem é a mesma régua de `detalheLiquido` (Promoções): lucro ÷ preço.
import { normalizarCombinacao, rotuloCombinacao } from '@/lib/kit-variacao';
import { calcularMarkup } from '@/lib/markup';
import type { ResumoLucro } from '@/lib/promocao-simulacao';
import { provenienciaDaTarifa, type DimensoesFrete, type Tarifa } from '@/lib/tarifa';

export interface PecaBase {
  cor: string;
  tamanho: string | null;
  custo: number | null;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  /** A edge lê só `excluida_da_publicacao=false`: peça excluída não existe para o kit. */
  excluidaDaPublicacao?: boolean;
}

export interface SkuKit { rotulo: string; tamanho: string; custo: number | null; dim: DimensoesFrete }

const texto = (v: unknown) => String(v ?? '').trim();
const pos = (n: number | null) => (n != null && n > 0 ? n : null);

/**
 * Custo e dimensões do SKU do kit, igual a `montarVariacaoKitVariacao` (criar-kit-variacao/processar.ts):
 * custo e peso somados, altura da primeira peça × N, largura e comprimento da primeira. A primeira é a da
 * ordem das cores marcadas. Peça sem custo → custo null (nunca 0). Peça que a base não tem → null.
 */
export function skuDoKit(variacoes: PecaBase[], marcadas: string[], cores: string[], tamanho: string): SkuKit | null {
  const cs = normalizarCombinacao(marcadas, cores);
  if (!cs) return null;
  const pecas: PecaBase[] = [];
  for (const cor of cs) {
    const v = variacoes.find((x) => !x.excluidaDaPublicacao && texto(x.cor) === texto(cor) && texto(x.tamanho) === texto(tamanho));
    if (!v) return null;
    pecas.push(v);
  }
  const [primeira] = pecas;
  const semCusto = pecas.some((p) => pos(p.custo) == null);
  const pesos = pecas.map((p) => pos(p.pesoGramas));
  return {
    rotulo: rotuloCombinacao(cs), tamanho,
    custo: semCusto ? null : Number(pecas.reduce((t, p) => t + p.custo!, 0).toFixed(2)),
    dim: {
      pesoGramas: pesos.includes(null) ? null : pesos.reduce<number>((t, p) => t + p!, 0),
      alturaCm: primeira.alturaCm == null ? null : primeira.alturaCm * pecas.length,
      larguraCm: primeira.larguraCm, comprimentoCm: primeira.comprimentoCm,
    },
  };
}

const PECA_INEXISTENTE = 'A base não tem uma das peças neste tamanho.';

/** Uma cotação por dimensões distintas: combinações de pesos diferentes podem mudar de faixa de frete. */
export const chaveDimensoes = (d: DimensoesFrete) => [d.alturaCm, d.larguraCm, d.comprimentoCm, d.pesoGramas].join('|');

/** Alíquota por origem (ADR-0055) só com confirmação em Configurações (ADR-0086). Nunca presume 8/16. */
export function aliquotaDoKit(
  origem: string | null | undefined,
  aliquotas: { nacional: number; importado: number; confirmada: boolean } | null | undefined,
): number | null {
  if (!aliquotas?.confirmada) return null;
  if (origem === 'importado') return aliquotas.importado;
  if (origem === 'nacional') return aliquotas.nacional;
  return null;
}

export interface LinhaSimulada extends SkuKit { resumo: ResumoLucro | null; motivo: string | null }
/** `sem_custo`: peça da base sem custo. A edge recusa (`base_sem_custo`), então bloqueia sem confirmação. */
/** `peca_inexistente`: combinação sem peça elegível na base; a edge recusa com `sku_inexistente`. Também bloqueia. */
export type EstadoSimulacao = 'calculando' | 'peca_inexistente' | 'sem_custo' | 'indisponivel' | 'prejuizo' | 'ok';
export interface SimulacaoKit {
  linhas: LinhaSimulada[];
  /** Menor lucro. Só existe quando todas as combinações têm conta (senão não dá para afirmar a pior). */
  pior: LinhaSimulada | null;
  estado: EstadoSimulacao;
  semAliquota: boolean;
  /** Prejuízo, conta indisponível ou imposto fora da conta: seguir exige confirmação explícita. */
  precisaConfirmar: boolean;
}

/** ResumoLucro (o mesmo de `DetalheRecebe`) a partir da tarifa oficial, sem recalcular nada. */
export function resumoDaTarifa(
  t: Tarifa, tipo: 'gold_special' | 'gold_pro', preco: number, custo: number, rotulo: string, aliquotaPct: number,
): ResumoLucro {
  const c = tipo === 'gold_pro' ? t.premium : t.classico;
  const { lucro, markup } = calcularMarkup(c.recebe, custo);
  return {
    comissao: c.comissao, comissaoPct: c.percentual, comissaoFixa: c.fixa, imposto: c.imposto,
    aliquotaPct,
    frete: t.frete, recebe: c.recebe, lucro, markup, margem: preco > 0 ? lucro / preco : null, custo, cor: rotulo,
  };
}

/**
 * `cotacoes` por `chaveDimensoes`: undefined = ainda cotando; null = indisponível. Cotação não oficial
 * (`partial`/`estimated`) também conta como indisponível: nunca mostrar estimativa como exata.
 */
export function simularKit(p: {
  preco: number; pecas: number; cores: string[];
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  variacoes: PecaBase[]; tipo: 'gold_special' | 'gold_pro'; aliquotaPct: number | null;
  cotacoes: Map<string, Tarifa | null | undefined>;
}): SimulacaoKit {
  let calculando = false;
  const linhas: LinhaSimulada[] = [];
  for (const q of p.quantidades) {
    if (!(q.quantidade > 0) || q.cores.length !== p.pecas) continue;
    const sku = skuDoKit(p.variacoes, p.cores, q.cores, q.tamanho);
    if (!sku) {
      linhas.push({ rotulo: rotuloCombinacao(q.cores), tamanho: q.tamanho, custo: null, dim: { pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null }, resumo: null, motivo: PECA_INEXISTENTE });
      continue;
    }
    const t = p.cotacoes.get(chaveDimensoes(sku.dim));
    if (t === undefined) { calculando = true; linhas.push({ ...sku, resumo: null, motivo: null }); continue; }
    const oficial = t != null && provenienciaDaTarifa(t).proveniencia === 'official';
    const motivo = sku.custo == null ? 'Peça sem custo na base.'
      : !oficial ? 'Não foi possível calcular a tarifa do Mercado Livre.' : null;
    linhas.push({ ...sku, resumo: motivo ? null : resumoDaTarifa(t!, p.tipo, p.preco, sku.custo!, sku.rotulo, p.aliquotaPct ?? 0), motivo });
  }
  const semAliquota = p.aliquotaPct == null;
  const faltaConta = linhas.some((l) => l.resumo == null && l.motivo != null);
  // Custo vem da base (o que a edge soma); sem ele a criação é recusada, não adianta cotar nem confirmar.
  if (linhas.some((l) => l.motivo === PECA_INEXISTENTE)) {
    return { linhas, pior: null, estado: 'peca_inexistente', semAliquota, precisaConfirmar: false };
  }
  if (linhas.some((l) => l.custo == null && l.motivo === 'Peça sem custo na base.')) {
    return { linhas, pior: null, estado: 'sem_custo', semAliquota, precisaConfirmar: false };
  }
  if (calculando) return { linhas, pior: null, estado: 'calculando', semAliquota, precisaConfirmar: false };
  if (faltaConta || linhas.length === 0) return { linhas, pior: null, estado: 'indisponivel', semAliquota, precisaConfirmar: true };
  const pior = linhas.reduce((a, b) => (b.resumo!.lucro < a.resumo!.lucro ? b : a));
  const estado = pior.resumo!.lucro < 0 ? 'prejuizo' : 'ok';
  return { linhas, pior, estado, semAliquota, precisaConfirmar: estado === 'prejuizo' || semAliquota };
}
