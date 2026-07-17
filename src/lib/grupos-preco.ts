// ADR-0078 F2: helpers da UI de preço por variação. Faixa = preço comparado a 2 casas
// (mesma regra de centavos do backend, _shared/preco/grupos.ts).
import type { Familia, Variacao } from './tipos-dominio';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface GrupoPreco { preco: number; variacoes: Variacao[]; }

/** Grupos de preço (faixas) das cores incluídas, do menor para o maior preço. */
export function gruposDePreco(familia: Pick<Familia, 'variacoes'>): GrupoPreco[] {
  const incluidas = familia.variacoes.filter((x) => !x.excluidaDaPublicacao);
  const base = incluidas.length > 0 ? incluidas : familia.variacoes;
  const porPreco = new Map<number, Variacao[]>();
  for (const x of base) {
    const p = round2(x.precoPublicacao ?? x.preco);
    (porPreco.get(p) ?? porPreco.set(p, []).get(p)!).push(x);
  }
  return [...porPreco.entries()]
    .sort(([a], [b]) => a - b)
    .map(([preco, variacoes]) => ({ preco, variacoes }));
}

/** Alvos da edição de preço. "Aplicar a todas" replica como hoje (editada + quem difere do
 *  novo preço); "só esta" salva apenas a editada. A mutation pina cada alvo salvo. */
export function alvosAplicarPreco(
  variacoes: Variacao[],
  codigoEditado: string,
  aplicarATodas: boolean,
  novoPreco: number,
): Variacao[] {
  if (!aplicarATodas) return variacoes.filter((x) => x.codigo === codigoEditado);
  return variacoes.filter((x) => x.codigo === codigoEditado || x.precoPublicacao !== novoPreco);
}

/** LOUD do UPDATE (invariante #4): variações publicadas do MESMO anúncio (proxy: mesmo
 *  precoPublicadoMl, a faixa viva delas) indo a preços novos DISTINTOS = honrar exige
 *  dividir/migrar (perde histórico). Repreçar o anúncio inteiro junto não conta. O backend
 *  (particionarPorPreco) é a verdade final; aqui é o aviso antecipado na Revisão. */
export function exigeDivisaoUpdate(familia: Pick<Familia, 'operacao' | 'variacoes'>): boolean {
  if (familia.operacao !== 'UPDATE') return false;
  const publicadas = familia.variacoes.filter(
    (x) => x.mlVariationId && !x.excluidaDaPublicacao && x.precoPublicadoMl != null,
  );
  const novosPorFaixa = new Map<number, Set<number>>();
  for (const x of publicadas) {
    const faixa = round2(x.precoPublicadoMl!);
    const novo = round2(x.precoPublicacao ?? x.preco);
    (novosPorFaixa.get(faixa) ?? novosPorFaixa.set(faixa, new Set()).get(faixa)!).add(novo);
  }
  return [...novosPorFaixa.values()].some((novos) => novos.size > 1);
}

/** Espelho do LOUD do backend (resolverConfigGrupo): família divergente com desconto/atacado
 *  ativo no família-level e grupo sem confirmação explícita → o publish vai falhar. O selo
 *  "configurar faixa" aponta isso ANTES de publicar. */
export function configGrupoPendente(
  familia: Pick<Familia, 'exibirComDesconto' | 'atacado'>,
  grupo: GrupoPreco,
): boolean {
  const famDesconto = familia.exibirComDesconto;
  const famAtacado = (familia.atacado ?? []).length > 0;
  if (!famDesconto && !famAtacado) return false;
  return grupo.variacoes.some(
    (x) => (famDesconto && x.exibirComDesconto == null) || (famAtacado && x.atacado == null),
  );
}
