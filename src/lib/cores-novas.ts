import type { Familia } from './tipos-dominio';

export interface FamiliaCorNova {
  codigoPai: string;
  titulo: string;
  codigos: string[];
}

// Cor nova de um anúncio já publicado (UPDATE) que ainda não tem foto. A cor nova
// entra desmarcada e fica silenciosa até ser incluída; este aviso a expõe assim que
// chega na planilha. CREATE não conta (não é reposição de um anúncio existente).
// Estoque 0 não conta: fica fora da publicação (dorme até repor) e não pede foto —
// só pede foto quando ganhar estoque numa próxima planilha.
export function coresNovasSemFoto(familias: Familia[]): FamiliaCorNova[] {
  const out: FamiliaCorNova[] = [];
  for (const f of familias) {
    if (f.operacao !== 'UPDATE') continue;
    const codigos = f.variacoes
      .filter((v) => !v.mlVariationId && !v.fotoPath && v.estoque > 0)
      .map((v) => v.codigo);
    if (codigos.length > 0) {
      out.push({ codigoPai: f.codigoPai, titulo: f.titulo, codigos });
    }
  }
  return out;
}

export function totalCoresNovasSemFoto(familias: Familia[]): number {
  return coresNovasSemFoto(familias).reduce((acc, f) => acc + f.codigos.length, 0);
}
