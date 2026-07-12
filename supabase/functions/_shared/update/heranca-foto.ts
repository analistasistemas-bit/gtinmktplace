/**
 * Decide o picture_id de uma foto num re-ingest UPDATE (ADR-0033 / plano 031).
 *
 * Os paths de imagem embutem o lote_id (`buildStoragePath` = `userId/loteId/arquivo`), então
 * todo re-ingest gera paths NOVOS. O picture_id herdado aponta para a foto que o ML cacheou do
 * lote ANTERIOR. Se o operador subiu uma foto neste re-ingest (`pathNovo != null`), não dá para
 * saber se é a mesma imagem — reusar o id publicaria a foto antiga (o `pre-subir-fotos` pula o
 * upload quando já há picId). Zeramos: força re-upload da imagem atual. Sem foto nova
 * (`pathNovo == null`, ex.: reposição de estoque só com planilha) preservamos a publicada
 * herdando o id.
 *
 * Invariante irmã de `pre-subir-fotos.ts`: quem TROCA uma foto zera o picture_id.
 */
export function herdarPictureId(pathNovo: string | null, idAnterior: string | null): string | null {
  return pathNovo ? null : idAnterior;
}
