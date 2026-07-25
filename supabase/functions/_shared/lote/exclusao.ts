export interface VariacaoExclusao { imagem_path: string | null; }
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

export function particionarExclusao(e: EntradaExclusao): ResultadoExclusao {
  // Preserva só famílias REALMENTE publicadas (publicado_em != null). Reposição UPDATE
  // herda ml_item_id do anúncio existente sem publicar nada — usar ml_item_id como
  // sinal preservava lotes de reposição em revisão, que então viravam "concluído" em
  // vez de serem excluídos (ambos os workers setam publicado_em ao publicar).
  const preservadas = e.familias.filter((f) => f.publicado_em != null);
  const paraExcluir = e.familias.filter((f) => f.publicado_em == null);
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
