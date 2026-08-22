export interface VariacaoExclusao {
  imagem_path: string | null;
  /** Vínculo com a variação viva no ML. Ausente/null = nada existe lá para ficar órfão. */
  ml_variation_id?: string | null;
}
export interface FamiliaExclusao {
  id: string;
  ml_item_id: string | null;
  publicado_em: string | null;
  capa_storage_path: string | null;
  capa2_storage_path: string | null;
  capa3_storage_path: string | null;
  variacoes: VariacaoExclusao[];
}
export interface EntradaExclusao {
  familias: FamiliaExclusao[];
  planilhaPath: string | null;
  imagensPaths: string[] | null;
  /**
   * Dono esperado dos arquivos: primeiro segmento de pasta de todo path que pode ser apagado.
   * Em excluir-lote é `lote.user_id` (que a própria edge já confirmou ser o chamador).
   */
  donoUserId: string;
  /**
   * Vínculos `ml_item_id|ml_variation_id` que sobrevivem FORA deste lote (`chaveVinculo`).
   * Ausente = desconhecido, e o guard anti-órfão trava fechado (ver `particionarExclusao`).
   */
  vinculosVivosFora?: ReadonlySet<string>;
}
export interface ResultadoExclusao {
  paraExcluir: FamiliaExclusao[];
  preservadas: FamiliaExclusao[];
  pathsRemover: string[];
  pathsPreservar: string[];
  loteVazio: boolean;
}

// Paths de Storage de uma família (capas + imagens das variações). Aceita qualquer
// objeto com esses campos (reusado pela edge remover-publicado).
export function pathsDaFamilia(f: {
  capa_storage_path: string | null;
  capa2_storage_path: string | null;
  capa3_storage_path: string | null;
  variacoes: VariacaoExclusao[];
}): string[] {
  return [
    f.capa_storage_path, f.capa2_storage_path, f.capa3_storage_path,
    ...f.variacoes.map((v) => v.imagem_path),
  ].filter((p): p is string => !!p);
}

/**
 * Guard de posse dos arquivos de Storage. Uploads sempre gravam sob `${userId}/…`
 * (src/lib/storage.ts, upload-imagens-lote/processar.ts), mas as colunas que guardam esses
 * caminhos — `lotes.imagens_paths`, `lotes.planilha_path`, `familias.capa*_storage_path` — são
 * escritas/editáveis pelo cliente. Como o delete roda com service_role (RLS de storage não se
 * aplica), um path injetado apagaria arquivo de terceiro. Só sobrevive o path cujo PRIMEIRO
 * segmento de pasta está em `donos`. Fail-closed: conjunto vazio remove tudo.
 */
export function filtrarPathsDeDonos(paths: string[], donos: ReadonlySet<string>): string[] {
  return paths.filter((p) => {
    const segmentos = p.split('/');
    // Precisa de dono + nome de arquivo, e nenhum '..' (travessia sairia do prefixo do dono).
    if (segmentos.length < 2 || !segmentos[0] || segmentos.includes('..')) return false;
    return donos.has(segmentos[0]);
  });
}

/**
 * Guard de posse cross-org para paths client-writable cujo dono não foi previamente
 * confirmado contra o chamador (ex.: `lotes.planilha_path` em ingest-lote, onde qualquer
 * membro DA MESMA ORG pode operar o lote de outro membro — ADR-0047/0056). Comparar contra
 * a própria coluna `user_id` da linha não basta: ela também é livre pro cliente escrever no
 * mesmo UPDATE que grava o path. Só confia no 1º segmento do path quando o profile a que ele
 * pertence é da org que está chamando; fail-closed (Set vazio) sem profile ou org diferente.
 */
export function donoDoPathNaOrg(
  donoOrgId: string | null | undefined,
  orgEsperado: string,
  candidatoUserId: string,
): ReadonlySet<string> {
  return donoOrgId === orgEsperado ? new Set([candidatoUserId]) : new Set();
}

/** Chave de um vínculo com o ML. Só existe quando os dois lados estão preenchidos. */
export function chaveVinculo(mlItemId: string | null, variationId: string | null | undefined): string | null {
  return mlItemId && variationId ? `${mlItemId}|${variationId}` : null;
}

function vinculosDaFamilia(f: FamiliaExclusao): string[] {
  return f.variacoes
    .map((v) => chaveVinculo(f.ml_item_id, v.ml_variation_id))
    .filter((k): k is string => k !== null);
}

export function particionarExclusao(e: EntradaExclusao): ResultadoExclusao {
  // Preserva só famílias REALMENTE publicadas (publicado_em != null). Reposição UPDATE
  // herda ml_item_id do anúncio existente sem publicar nada — usar ml_item_id como
  // sinal preservava lotes de reposição em revisão, que então viravam "concluído" em
  // vez de serem excluídos (ambos os workers setam publicado_em ao publicar).
  const publicadas = e.familias.filter((f) => f.publicado_em != null);
  const naoPublicadas = e.familias.filter((f) => f.publicado_em == null);

  // Guard anti-órfão (incidente 2026-08-13, linha Xik cor Azul): `publicado_em` sozinho não
  // basta. O UPDATE pode ter CRIADO a variação no ML e mesmo assim não marcar a família como
  // publicada (guard de update-familia-ml, cor nova sem vínculo devolvido). Apagando aqui a
  // última família que representa esse `ml_variation_id`, a variação continua viva no anúncio
  // e nada no banco a representa: vende e não baixa estoque, sem alerta.
  //
  // Cobertos = vínculos que sobrevivem fora do lote + os das publicadas deste lote. Um vínculo
  // fora dessa lista não tem outro dono, então a família fica.
  // `vinculosVivosFora` ausente = não deu para consultar: trava fechado (preserva), porque
  // preservar demais é reversível e a órfã só reaparece numa venda perdida.
  const conhece = e.vinculosVivosFora !== undefined;
  const cobertos = new Set([
    ...(e.vinculosVivosFora ?? []),
    ...publicadas.flatMap(vinculosDaFamilia),
  ]);
  const criaOrfa = (f: FamiliaExclusao) =>
    vinculosDaFamilia(f).some((k) => !conhece || !cobertos.has(k));

  const preservadas = [...publicadas, ...naoPublicadas.filter(criaOrfa)];
  const paraExcluir = naoPublicadas.filter((f) => !criaOrfa(f));
  const pathsPreservar = [...new Set(preservadas.flatMap(pathsDaFamilia))];
  const preservarSet = new Set(pathsPreservar);
  const candidatos = [
    ...paraExcluir.flatMap(pathsDaFamilia),
    ...(e.planilhaPath ? [e.planilhaPath] : []),
    ...(e.imagensPaths ?? []),
  ];
  const pathsRemover = filtrarPathsDeDonos(
    [...new Set(candidatos)].filter((p) => !preservarSet.has(p)),
    new Set([e.donoUserId]),
  );
  return { paraExcluir, preservadas, pathsRemover, pathsPreservar, loteVazio: preservadas.length === 0 };
}
