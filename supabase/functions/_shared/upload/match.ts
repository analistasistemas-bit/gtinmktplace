export type Classificacao =
  | { tipo: 'capa'; codigo: string }
  | { tipo: 'variacao'; codigo: string }
  | { tipo: 'invalido' };

const REGEX_CAPA = /^CAPA_(\d{8})\.(jpe?g|png)$/i;
const REGEX_VARIACAO = /^(\d{8})\.(jpe?g|png)$/i;

export function classificarArquivo(nome: string): Classificacao {
  const mCapa = nome.match(REGEX_CAPA);
  if (mCapa && nome.startsWith('CAPA_')) {
    return { tipo: 'capa', codigo: mCapa[1] };
  }
  const mVar = nome.match(REGEX_VARIACAO);
  if (mVar) {
    return { tipo: 'variacao', codigo: mVar[1] };
  }
  return { tipo: 'invalido' };
}
