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
  mlItemId: string;
  mlPermalink: string | null;
  publicadoEm: string | null;
  // preenchidos pelo status ao vivo (merge no hook):
  status?: StatusPublicado;
  estoque?: number | null;
  precoAtual?: number | null;
  motivo?: string | null;
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
