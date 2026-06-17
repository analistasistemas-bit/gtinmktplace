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

// Cores que viram variação NOVA no ML (sem ml_variation_id) e têm estoque — precisam
// de foto antes de publicar. Base = ml_variation_id (igual à seção "Cores novas" da
// Revisão e às críticas), NÃO `mudancaEstrutural.novas`: este diff do ingest pode não
// listar cores que já existiam na família mas nunca foram publicadas no anúncio.
// Estoque 0 não conta (dorme até reposição). Em ordem alfabética.
export function coresNovasComEstoque(familia: Familia): Variacao[] {
  if (familia.operacao !== 'UPDATE') return [];
  return familia.variacoes
    .filter((v) => !v.mlVariationId && v.estoque > 0)
    .sort(compararCor);
}

// Cores que ficaram FORA da publicação por não terem foto (vêm desmarcadas no
// ingest; CREATE e UPDATE cor-nova). Base do aviso na Revisão: o operador vê o que
// caiu fora sem precisar abrir a família. Só conta as com estoque — estoque 0 já
// dorme até reposição e não exige foto. Excluída COM foto = decisão manual, não
// entra aqui. Em ordem alfabética.
export function coresSemFotoExcluidas(familia: Familia): Variacao[] {
  return familia.variacoes
    .filter((v) => v.excluidaDaPublicacao && !v.fotoPath && v.estoque > 0)
    .sort(compararCor);
}
