import type { FiltroPublicados, OrdenacaoPublicados, StatusPublicado, ColunaOrdenavel } from '@/lib/publicados';

export const TAMANHO_PADRAO = 10;
const TAMANHOS_VALIDOS = [5, 10, 20, 50];

export interface EstadoPublicados {
  filtro: FiltroPublicados;
  ord: OrdenacaoPublicados | null;
  pagina: number;
  tamanho: number;
}

const STATUSES: StatusPublicado[] = ['ativo', 'pausado', 'encerrado', 'moderado', 'inativo', 'indisponivel'];
const COLUNAS: ColunaOrdenavel[] = [
  'titulo', 'fornecedor', 'tipo', 'precoPublicacao', 'estoque', 'precoAtual',
  'unidadesVendidas', 'valorVendido', 'status', 'publicadoEm',
];

/** Serializa o estado da Publicados em query params (omite os defaults). */
export function estadoParaParams(e: EstadoPublicados): URLSearchParams {
  const p = new URLSearchParams();
  if (e.filtro.busca?.trim()) p.set('q', e.filtro.busca);
  if (e.filtro.fornecedor) p.set('fornecedor', e.filtro.fornecedor);
  if (e.filtro.status) p.set('status', e.filtro.status);
  if (e.filtro.tipo) p.set('tipo', e.filtro.tipo);
  if (e.filtro.somenteEncalhados) p.set('encalhados', '1');
  if (e.ord) {
    p.set('ord', e.ord.coluna);
    p.set('dir', e.ord.dir);
  }
  if (e.pagina > 1) p.set('pg', String(e.pagina));
  if (e.tamanho !== TAMANHO_PADRAO) p.set('ts', String(e.tamanho));
  return p;
}

/** Lê o estado da Publicados dos query params, validando o domínio (lixo vira null). */
export function paramsParaEstado(p: URLSearchParams): EstadoPublicados {
  const status = p.get('status');
  const ordCol = p.get('ord');

  const filtro: FiltroPublicados = {
    busca: p.get('q') ?? undefined,
    fornecedor: p.get('fornecedor') ?? null,
    status: status && (STATUSES as string[]).includes(status) ? (status as StatusPublicado) : null,
    // Tipo agora é o rótulo exibido (categoria real do ML) — texto livre, como fornecedor.
    tipo: p.get('tipo') || null,
  };
  // Só incluímos a chave quando ligada (ausente = não filtra), p/ não poluir o estado default.
  if (p.get('encalhados') === '1') filtro.somenteEncalhados = true;

  const ord: OrdenacaoPublicados | null =
    ordCol && (COLUNAS as string[]).includes(ordCol)
      ? { coluna: ordCol as ColunaOrdenavel, dir: p.get('dir') === 'desc' ? 'desc' : 'asc' }
      : null;

  const pagina = Math.max(1, parseInt(p.get('pg') ?? '1', 10) || 1);
  const tsRaw = parseInt(p.get('ts') ?? '', 10);
  const tamanho = TAMANHOS_VALIDOS.includes(tsRaw) ? tsRaw : TAMANHO_PADRAO;

  return { filtro, ord, pagina, tamanho };
}
