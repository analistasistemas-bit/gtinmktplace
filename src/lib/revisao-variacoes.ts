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
// da lista. Antes de publicar, mostra todas. Não muta a entrada.
export function variacoesParaRevisao(variacoes: Variacao[], publicado: boolean): Variacao[] {
  const ordenadas = [...variacoes].sort(compararCor);
  return publicado ? ordenadas.filter((v) => !v.mlVariationId) : ordenadas;
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
