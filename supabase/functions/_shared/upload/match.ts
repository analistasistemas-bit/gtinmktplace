export type Classificacao =
  | { tipo: 'capa'; codigo: string }
  | { tipo: 'capa2'; codigo: string }
  | { tipo: 'capa3'; codigo: string }
  | { tipo: 'variacao'; codigo: string }
  | { tipo: 'invalido' };

const REGEX_CAPA = /^CAPA_(\d{8})\.(jpe?g|png)$/i;
const REGEX_CAPA2 = /^CAPA2_(\d{8})\.(jpe?g|png)$/i;
const REGEX_CAPA3 = /^CAPA3_(\d{8})\.(jpe?g|png)$/i;
const REGEX_VARIACAO = /^(\d{8})\.(jpe?g|png)$/i;

export function classificarArquivo(nome: string): Classificacao {
  const mCapa3 = nome.match(REGEX_CAPA3);
  if (mCapa3 && nome.startsWith('CAPA3_')) {
    return { tipo: 'capa3', codigo: mCapa3[1] };
  }
  const mCapa2 = nome.match(REGEX_CAPA2);
  if (mCapa2 && nome.startsWith('CAPA2_')) {
    return { tipo: 'capa2', codigo: mCapa2[1] };
  }
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
