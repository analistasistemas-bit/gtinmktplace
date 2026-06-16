import type { Familia, Variacao } from './tipos-dominio';

// Compara duas variações pelo nome da cor (cai no código quando sem cor), em ordem
// alfabética pt-BR: case/acento-insensível e com sufixo numérico natural (ex.: "Azul 2"
// antes de "Azul 10"). Espelha `ordenarCoresAlfabetica` do backend (descrição do ML).
export function compararCor(a: Variacao, b: Variacao): number {
  return (a.cor || a.codigo).localeCompare(b.cor || b.codigo, 'pt-BR', {
    sensitivity: 'base',
    numeric: true,
  });
}

// Variações exibidas na Revisão: sempre em ordem alfabética de cor. Depois de a família
// ser publicada, mostra só as que NÃO foram para o anúncio (sem ml_variation_id) — as
// cores que "não conseguiram publicar" (ex.: cor nova sem foto); as já publicadas saem
// da lista. Antes de publicar, mostra todas. `ocultarSemEstoque` (filtro da barra da
// Revisão) esconde as cores com estoque 0, que dormem até reposição. Não muta a entrada.
export function variacoesParaRevisao(
  variacoes: Variacao[],
  publicado: boolean,
  ocultarSemEstoque = false,
): Variacao[] {
  const ordenadas = [...variacoes].sort(compararCor);
  let r = publicado ? ordenadas.filter((v) => !v.mlVariationId) : ordenadas;
  if (ocultarSemEstoque) r = r.filter((v) => v.estoque > 0);
  return r;
}

export interface GruposRevisao {
  reposicao: Variacao[];
  novas: Variacao[];
}

// Separa as variações exibidas (UPDATE) em dois grupos para a Revisão não misturar o
// que exige ação com o que não exige: `reposicao` = cor já no anúncio (tem ml_variation_id,
// só atualiza estoque/preço) e `novas` = cor sem ml_variation_id (vira variação nova e
// precisa de foto/cor). Preserva a ordem recebida (já alfabética). CREATE não usa isto.
export function agruparRevisaoUpdate(variacoes: Variacao[]): GruposRevisao {
  const reposicao: Variacao[] = [];
  const novas: Variacao[] = [];
  for (const v of variacoes) {
    if (v.mlVariationId) reposicao.push(v);
    else novas.push(v);
  }
  return { reposicao, novas };
}

// Cores novas (mudança estrutural detectada no ingest) que ainda NÃO foram publicadas
// — sem ml_variation_id. O campo `mudancaEstrutural.novas` é estático (do ingest) e
// continua listando todas mesmo após publicá-las; este filtro deixa no aviso só as
// pendentes (ex.: cor nova sem foto). Devolve {codigo, cor} em ordem alfabética.
export function coresNovasPendentes(familia: Familia): { codigo: string; cor: string }[] {
  const novas = familia.mudancaEstrutural?.novas ?? [];
  const porCodigo = new Map(familia.variacoes.map((v) => [v.codigo, v]));
  return novas
    .map((c) => porCodigo.get(c))
    .filter((v): v is Variacao => v != null && !v.mlVariationId)
    .sort(compararCor)
    .map((v) => ({ codigo: v.codigo, cor: v.cor || v.codigo }));
}
