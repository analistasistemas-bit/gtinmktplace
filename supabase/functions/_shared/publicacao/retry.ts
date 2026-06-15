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
