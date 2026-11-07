// ADR-0196 — regras puras do atacado no reajuste: as faixas valem em R$ no ML, mas o operador configura em % (ADR-0041).
import type { FaixaAtacado } from '../../canais/contrato.ts';
import { calcularAlvo, centavos } from './alvo.ts';
import type { FaixaPreco } from './tipos.ts';

export const MAX_FAIXAS = 5;
export const MSG_ATACADO_MUDOU = 'Não revertível: o atacado mudou depois da alteração';
export const MSG_ATACADO_POR_COR = 'Atacado por cor: ajuste na Revisão';
export const MSG_ATACADO_ENTRE_CORES = 'Atacado diferente entre cores — ajuste na Revisão';
export const MSG_ATACADO_ENTRE_LOTES = 'Atacado diferente entre lotes — ajuste na Revisão';

/** `faixas` null = nada configurado; [] = explicitamente sem atacado. `porCor`: alguma cor tem configuração própria.
 *  `lotesDivergentes` vem sempre com `divergente`. */
export interface ConfigMlb { faixas: FaixaAtacado[] | null; divergente: boolean; porCor?: boolean; lotesDivergentes?: boolean }
export type DecisaoFaixas =
  | { acao: 'nenhuma' | 'recalcular'; faixas_alvo: FaixaPreco[] | null }
  | { acao: 'fora'; motivo: string };

const porQuantidade = <T extends { min_unidades: number }>(fs: T[]) => [...fs].sort((a, b) => a.min_unidades - b.min_unidades);

export function faixasDoAlvo(alvo: number, config: FaixaAtacado[]): FaixaPreco[] {
  return porQuantidade(config).map((f) => ({
    min_unidades: f.min_unidades,
    // 0 quando o desconto zera o preço: `faixasValidas` recusa.
    preco: calcularAlvo(alvo, { tipo: 'pct', sentido: '-', valor: f.desconto_pct }) ?? 0,
  }));
}

export function faixasValidas(base: number, faixas: FaixaPreco[]): boolean {
  const b = centavos(base);
  return faixas.length <= MAX_FAIXAS && faixas.every((f, i) =>
    centavos(f.preco) > 0 && centavos(f.preco) < b && Number.isInteger(f.min_unidades) && f.min_unidades >= 2 &&
    (i === 0 || f.min_unidades > faixas[i - 1].min_unidades));
}

const chave = (fs: FaixaPreco[]) => fs.map((f) => `${f.min_unidades}:${centavos(f.preco)}`).sort().join('|');

export function mesmasFaixas(a: FaixaPreco[], b: FaixaPreco[]): boolean {
  return chave(a) === chave(b);
}

const comoFaixas = (x: unknown) => (Array.isArray(x) ? (x as FaixaAtacado[]) : null);
const chaveConfig = (fs: FaixaAtacado[] | null) => JSON.stringify(porQuantidade(fs ?? []).map((f) => [f.min_unidades, f.desconto_pct]));
export const mesmaConfig = (a: FaixaAtacado[] | null, b: FaixaAtacado[] | null) => chaveConfig(a) === chaveConfig(b);

/** Configuração única do anúncio. Cor sem configuração e cor com [] são iguais: nenhuma tem atacado. */
export function configDoMlb(variacoes: { atacado: unknown }[], familia: { atacado: unknown }): ConfigMlb {
  const efetivas = variacoes.map((v) => comoFaixas(v.atacado) ?? comoFaixas(familia.atacado));
  if (new Set(efetivas.map(chaveConfig)).size > 1) return { faixas: null, divergente: true };
  return { faixas: efetivas.find((f) => f !== null) ?? null, divergente: false };
}

/** Configuração do produto: a única não nula entre as linhas (lotes) dele. A canônica costuma ser NULL e não a esconde. */
export function configDoProduto(linhas: { atacado: unknown }[]): { atacado: FaixaAtacado[] | null; divergente: boolean } {
  const unicas = new Map(linhas.filter((l) => l.atacado != null).map((l) => [JSON.stringify(l.atacado), l.atacado as FaixaAtacado[]]));
  return unicas.size > 1 ? { atacado: null, divergente: true } : { atacado: [...unicas.values()][0] ?? null, divergente: false };
}

const quantidades = (fs: { min_unidades: number }[]) => porQuantidade(fs).map((f) => f.min_unidades).join();

/** Só recalcula as faixas que existem vivas, com as mesmas quantidades da configuração. Mudar preço nunca cria nem
 *  apaga faixa: fora disso as vivas seguem como estão, inclusive com `[]`, e a que cruzar o alvo tira o item.
 *  `editando`: o operador redefiniu o % da família, então as faixas seguem a configuração, com ou sem vivas. Sempre há
 *  passo, porque a conclusão da família exige todos confirmados. */
export function decidirFaixas(alvo: number, vivas: FaixaPreco[], config: ConfigMlb | null, editando = false): DecisaoFaixas {
  if (config?.divergente) return { acao: 'fora', motivo: config.lotesDivergentes ? MSG_ATACADO_ENTRE_LOTES : MSG_ATACADO_ENTRE_CORES };
  const nenhuma: DecisaoFaixas = { acao: 'nenhuma', faixas_alvo: null };
  if (!config?.faixas || (!editando && quantidades(config.faixas) !== quantidades(vivas))) {
    return vivas.some((f) => centavos(f.preco) >= centavos(alvo))
      ? { acao: 'fora', motivo: 'Faixa de atacado ficaria acima do preço base' }
      : nenhuma;
  }
  const faixas_alvo = faixasDoAlvo(alvo, config.faixas);
  if (!faixasValidas(alvo, faixas_alvo)) return { acao: 'fora', motivo: 'Faixa de atacado inválida para este preço — ajuste na Revisão' };
  return !editando && mesmasFaixas(vivas, faixas_alvo) ? nenhuma : { acao: 'recalcular', faixas_alvo };
}
