import { supabase } from '@/lib/supabase';
import { buscarTodasPaginasParalelo } from '@/lib/paginacao-supabase';

/** Uma linha por código (variação), da família mais recente da org — RPC vendas_sku_catalogo (ADR-0172). */
export interface CatalogoSku {
  codigo: string;
  codigoPai: string | null;
  nomeFamilia: string | null;
  nome: string | null;
  cor: string | null;
  tamanho: string | null;
  estoque: number;
  fornecedor: string | null;
  origem: 'nacional' | 'importado' | null;
  ehKit: boolean;
  primeiraVenda: string | null;
  ultimaVenda: string | null;
}

type Raw = Record<string, unknown>;
const txt = (v: unknown): string | null => (v == null ? null : String(v));

export function mapCatalogoSku(r: Raw): CatalogoSku {
  const origem = r.origem === 'nacional' || r.origem === 'importado' ? r.origem : null;
  return {
    codigo: String(r.codigo),
    codigoPai: txt(r.codigo_pai),
    nomeFamilia: txt(r.nome_familia),
    nome: txt(r.nome),
    cor: txt(r.cor),
    tamanho: txt(r.tamanho),
    estoque: Number(r.estoque ?? 0),
    fornecedor: txt(r.fornecedor),
    origem,
    ehKit: r.eh_kit === true,
    primeiraVenda: txt(r.primeira_venda),
    ultimaVenda: txt(r.ultima_venda),
  };
}

/** Paginado por GET: RPC por POST ignora o header Range (teto de 1.000 linhas do PostgREST). */
export async function fetchCatalogoVendasSku(): Promise<CatalogoSku[]> {
  const data = await buscarTodasPaginasParalelo<Raw>((de, ate) =>
    supabase.rpc('vendas_sku_catalogo', undefined, { get: true }).range(de, ate) as unknown as PromiseLike<{
      data: Raw[] | null; error: { message: string } | null;
    }>);
  return data.map(mapCatalogoSku);
}
