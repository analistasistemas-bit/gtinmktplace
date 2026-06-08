export interface VariacaoExclusao { imagem_path: string | null; }
export interface FamiliaExclusao {
  id: string;
  ml_item_id: string | null;
  capa_storage_path: string | null;
  capa2_storage_path: string | null;
  variacoes: VariacaoExclusao[];
}
export interface EntradaExclusao {
  familias: FamiliaExclusao[];
  planilhaPath: string | null;
  imagensPaths: string[] | null;
}
export interface ResultadoExclusao {
  paraExcluir: FamiliaExclusao[];
  preservadas: FamiliaExclusao[];
  pathsRemover: string[];
  pathsPreservar: string[];
  loteVazio: boolean;
}

function pathsDaFamilia(f: FamiliaExclusao): string[] {
  return [
    f.capa_storage_path, f.capa2_storage_path,
    ...f.variacoes.map((v) => v.imagem_path),
  ].filter((p): p is string => !!p);
}

export function particionarExclusao(e: EntradaExclusao): ResultadoExclusao {
  const preservadas = e.familias.filter((f) => f.ml_item_id != null);
  const paraExcluir = e.familias.filter((f) => f.ml_item_id == null);
  const pathsPreservar = [...new Set(preservadas.flatMap(pathsDaFamilia))];
  const preservarSet = new Set(pathsPreservar);
  const candidatos = [
    ...paraExcluir.flatMap(pathsDaFamilia),
    ...(e.planilhaPath ? [e.planilhaPath] : []),
    ...(e.imagensPaths ?? []),
  ];
  const pathsRemover = [...new Set(candidatos)].filter((p) => !preservarSet.has(p));
  return { paraExcluir, preservadas, pathsRemover, pathsPreservar, loteVazio: preservadas.length === 0 };
}
