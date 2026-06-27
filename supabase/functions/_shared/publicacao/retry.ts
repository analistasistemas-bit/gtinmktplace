import type { ErroCanal } from '../canais/contrato.ts';

export type DecisaoErroPublicacao = 'retentar' | 'definitivo';

const MAX_RETRIES_TRANSIENTES = 3;

export function decidirErroCriarAnuncio(erro: ErroCanal, tentativasQstash: number): DecisaoErroPublicacao {
  if (!erro.retentavel) return 'definitivo';

  return tentativasQstash < MAX_RETRIES_TRANSIENTES ? 'retentar' : 'definitivo';
}

export function mensagemErroFotoRecuperavel(mensagem: string): string {
  return `${mensagem} As fotos serao reenviadas na proxima tentativa; tente publicar novamente em alguns instantes.`;
}

/** Decide se um erro generico lancado por um worker deve ser retentado pelo QStash.
 *  Transitorios (5xx, 429, marcados `retentavel`) -> retenta. Default conservador:
 *  status desconhecido -> retenta (nao estrandar a familia). 4xx conhecido -> nao. */
export function decidirRetryPorErro(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const retentavel = (err as { retentavel?: boolean } | null)?.retentavel === true;
  if (retentavel) return true;
  if (status === undefined) return true;
  if (status >= 500 || status === 429) return true;
  return false;
}
