// Task 7 (ADR-0166 2026-09-24c): miolo PURO de "Adicionar à grade" — DialogEstenderGrade estende
// a matriz Cor × Tamanho de um produto de grade JÁ PUBLICADO no Mercado Livre (User Products). As
// células dos SKUs vivos ficam travadas (MatrizGrade.bloqueadas, Task 6); este arquivo deriva os
// eixos/travas a partir deles e monta o payload que a edge `adicionar-variacoes-familia` espera
// (contrato da Task 5, `VariacaoNovaEntrada` sem `codigo` — em grade o código é gerado no servidor).
//
// Reaproveita `LinhaResolvida`/`chaveGrade` de `cadastro-grade.ts`: nenhum modelo de dados novo,
// só a leitura de mais uma fonte (os SKUs já publicados) por cima do mesmo miolo da grade.
import { parseNumeroPtBr } from '@/lib/formato';
import { chaveGrade, type LinhaResolvida } from '@/lib/cadastro-grade';

/** SKU vivo da família publicada mais recente (a que a edge resolve sozinha a partir do
 *  codigo_pai). `excluida` = `excluida_da_publicacao`: continua travando a célula (a edge recusa
 *  o par de qualquer forma), mas não conta como foto herdável nem decide o tipo da grade. */
export interface SkuExistente {
  codigo: string; cor: string; tamanho: string; estoque: number; temFoto: boolean; excluida: boolean;
}

/** Eixos cor/tamanho dos SKUs recebidos — ordem de inserção preservada (é o `Set` que a matriz
 *  usa como seed antes de `ordenarEixos` reordenar). Quem chama filtra por `!excluida` quando só
 *  as incluídas devem contribuir eixo (Codex r6 #2 no brief). */
export function eixosExistentes(skus: SkuExistente[]): { cores: Set<string>; tamanhos: Set<string> } {
  return {
    cores: new Set(skus.map((s) => s.cor)),
    tamanhos: new Set(skus.map((s) => s.tamanho)),
  };
}

/** Uma entrada por SKU vivo, por `chaveGrade(cor, tamanho)` — é o que `MatrizGrade.bloqueadas`
 *  consome direto. `excluida` só entra na saída quando `true` (o rótulo "fora do anúncio" da
 *  matriz depende da PRESENÇA da chave, não de um `false` explícito). */
export function bloqueadasDe(skus: SkuExistente[]): Map<string, { estoque: number; excluida?: boolean }> {
  const mapa = new Map<string, { estoque: number; excluida?: boolean }>();
  for (const s of skus) {
    mapa.set(chaveGrade(s.cor, s.tamanho), { estoque: s.estoque, excluida: s.excluida || undefined });
  }
  return mapa;
}

/** SKU vivo da mesma cor cuja foto o SKU novo herda: o de MENOR código, entre os que têm foto e
 *  NÃO estão excluídos do anúncio (uma excluída pode estar incompleta — não é referência
 *  confiável, mesma razão de `irmaRef` em dialog-adicionar-variacao.tsx). `null` = cor nova ou
 *  cor sem nenhuma foto elegível — quem chama (o dialog) trava o salvar nesse caso. */
export function fotoHerdavel(cor: string, skus: SkuExistente[]): string | null {
  const candidatos = skus
    .filter((s) => s.cor === cor && s.temFoto && !s.excluida)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'));
  return candidatos[0]?.codigo ?? null;
}

/** `VariacaoNovaEntrada` da edge (`adicionar-variacoes-familia/processar.ts`) sem `codigo`: em
 *  grade o código nasce no servidor (`proximo_codigo_produto`), nunca digitado aqui. Redefinido
 *  no frontend (não importado do Deno) porque `src/lib` não pode depender de `supabase/functions`
 *  além dos arquivos FOLHA já reexportados em `tamanhos.ts`. */
export interface VariacaoGradePayload {
  nome: string;
  tamanho: string;
  gtin: string | null;
  preco: number;
  custo: number | null;
  estoqueInicial: number;
  pesoGramas: number | null;
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  /** Foto enviada agora. Mutuamente exclusiva com `fotoDeCodigo` — a edge recusa as duas ou
   *  nenhuma (`validarEntrada`). */
  imagemPath?: string;
  /** OU: herda a foto do SKU vivo com este código (mesma cor). */
  fotoDeCodigo?: string;
}

/** `null`/`NaN` (texto inválido) viram `null` — mesma conversão defensiva de `numOuNull` em
 *  dialog-adicionar-variacao.tsx. */
function numOuNull(v: string): number | null {
  const n = parseNumeroPtBr(v);
  return typeof n === 'number' && !Number.isNaN(n) ? n : null;
}

/**
 * Monta o payload da edge a partir das linhas RESOLVIDAS (herança já aplicada, mesma fonte que a
 * matriz mostra — nunca resolve herança por conta própria, espelha `submeter()` do cadastro em
 * grade). Foto: linha com `foto` própria usa o path já enviado (`imagemPorClientId`); sem foto
 * própria, herda da cor (`fotoHerdavel`). R6 do controlador: as chaves `imagemPath`/`fotoDeCodigo`
 * NUNCA saem como `null` — quando uma não se aplica, ela é OMITIDA (a edge trata `=== undefined`
 * como ausente; `null` explícito quebraria a checagem de "exatamente uma origem de foto").
 */
export function payloadEstender(
  resolvidas: LinhaResolvida[], skus: SkuExistente[], imagemPorClientId: Map<string, string>,
): VariacaoGradePayload[] {
  return resolvidas.map((r) => {
    const payload: VariacaoGradePayload = {
      nome: r.cor,
      tamanho: r.tamanho,
      gtin: r.gtin.trim() || null,
      preco: numOuNull(r.preco) ?? 0,
      custo: numOuNull(r.custo),
      estoqueInicial: numOuNull(r.estoqueInicial) ?? 0,
      pesoGramas: numOuNull(r.pesoGramas),
      alturaCm: numOuNull(r.alturaCm),
      larguraCm: numOuNull(r.larguraCm),
      comprimentoCm: numOuNull(r.comprimentoCm),
    };
    if (r.foto) {
      const imagemPath = imagemPorClientId.get(r.clientId);
      if (imagemPath) payload.imagemPath = imagemPath;
    } else {
      const fotoDeCodigo = fotoHerdavel(r.cor, skus);
      if (fotoDeCodigo) payload.fotoDeCodigo = fotoDeCodigo;
    }
    return payload;
  });
}
