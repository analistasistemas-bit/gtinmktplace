import type { ErroCanal } from '../canais/contrato.ts';

export type DecisaoErroPublicacao = 'retentar' | 'definitivo';

// Casa com RETRIES_PUBLICACAO_ML (_shared/queue.ts): rede de segurança para o item.pictures.unavailable
// quando a foto ainda não propagou no publish (o pré-upload em process-familia cobre o caso comum).
// 10 tentativas × 30s = ~5 min, o pior caso de propagação medido (lote #31).
const MAX_RETRIES_TRANSIENTES = 10;

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

/** Versão de `decidirErroCriarAnuncio` para workers que sinalizam erro por EXCEÇÃO (UPDATE/split):
 *  retenta transitório (5xx/429 ou foto retentável — item.pictures.unavailable, ainda propagando)
 *  enquanto houver tentativa do QStash; ao esgotar, definitivo. Requer que o erro carregue `status`
 *  e `retentavel` (o worker deve repassá-los ao lançar). */
export function decidirRetryTransitorio(err: unknown, tentativasQstash: number): DecisaoErroPublicacao {
  if (!decidirRetryPorErro(err)) return 'definitivo';
  return tentativasQstash < MAX_RETRIES_TRANSIENTES ? 'retentar' : 'definitivo';
}
