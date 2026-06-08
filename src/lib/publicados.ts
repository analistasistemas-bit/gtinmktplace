import type { TipoAviamento } from './tipos-dominio';

export type StatusPublicado =
  | 'ativo'
  | 'pausado'
  | 'encerrado'
  | 'moderado'
  | 'inativo'
  | 'indisponivel';

export interface PublicadoItem {
  familiaId: string;
  codigoPai: string;
  titulo: string;
  fornecedor: string | null;
  tipo: TipoAviamento | null;
  precoPublicacao: number;
  descricao: string | null;
  mlItemId: string;
  mlPermalink: string | null;
  publicadoEm: string | null;
  // preenchidos pelo status ao vivo (merge no hook):
  status?: StatusPublicado;
  estoque?: number | null;
  precoAtual?: number | null;
  motivo?: string | null;
}

// Um anúncio no ML = um ml_item_id, mas após ciclos de UPDATE há VÁRIAS linhas em
// `familias` com o mesmo ml_item_id (uma por lote). A tela Publicados lista 1 por anúncio:
// agrupa por mlItemId e escolhe o representante (publicado real primeiro — publicadoEm não
// nulo; entre eles o mais antigo = publicação original). Preenche o fornecedor de qualquer
// linha do grupo que o tenha (lotes antigos podem não ter a coluna).
export function dedupePublicados(itens: PublicadoItem[]): PublicadoItem[] {
  const grupos = new Map<string, PublicadoItem[]>();
  for (const it of itens) {
    const arr = grupos.get(it.mlItemId);
    if (arr) arr.push(it);
    else grupos.set(it.mlItemId, [it]);
  }
  const out: PublicadoItem[] = [];
  for (const grupo of grupos.values()) {
    const rep = [...grupo].sort((a, b) => {
      if (a.publicadoEm && !b.publicadoEm) return -1;
      if (!a.publicadoEm && b.publicadoEm) return 1;
      if (a.publicadoEm && b.publicadoEm) return a.publicadoEm.localeCompare(b.publicadoEm);
      return 0;
    })[0];
    const fornecedor = rep.fornecedor ?? grupo.find((g) => g.fornecedor)?.fornecedor ?? null;
    out.push({ ...rep, fornecedor });
  }
  return out;
}

export interface FiltroPublicados {
  fornecedor?: string | null;
  status?: StatusPublicado | null;
  tipo?: TipoAviamento | null;
  busca?: string;
}

export function filtrarPublicados(
  itens: PublicadoItem[],
  f: FiltroPublicados,
): PublicadoItem[] {
  const q = (f.busca ?? '').trim().toLowerCase();
  return itens.filter(
    (i) =>
      (!f.fornecedor || i.fornecedor === f.fornecedor) &&
      (!f.status || i.status === f.status) &&
      (!f.tipo || i.tipo === f.tipo) &&
      (!q || i.titulo.toLowerCase().includes(q)),
  );
}
