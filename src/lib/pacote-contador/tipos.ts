// ADR-0181 Plano 2a — modelo do pacote do contador (vendas). Valores em centavos inteiros.
export type TipoNota = 'venda' | 'complementar' | 'devolucao';
export type StatusNota = 'autorizada' | 'cancelada';

export interface NotaRelatorio {
  chave: string; numero: string; serie: string;
  emissao: string;      // dhEmi original
  instante: number;     // epoch ms de dhEmi
  competencia: string;  // AAAA-MM em America/Sao_Paulo
  tipo: TipoNota; status: StatusNota;
  produtosC: number; freteC: number; descontoC: number; totalC: number;
  cartaCorrecao: boolean; arquivo: string;
}

export interface Inutilizacao {
  arquivo: string; serie: string; inicio: string; fim: string;
  homologada: boolean; cStat: string; motivo: string;
}

export interface Conferencia {
  mes: string; vazio: boolean; mesEmAndamento: boolean; indisponivel: string | null;
  parcial: boolean; motivosParcial: string[];
  totalArquivos: number;
  contagem: Record<string, number>;
  outros: Array<{ arquivo: string; chave: string; cfops: string[] }>;
  denegadas: Array<{ arquivo: string; chave: string; cStat: string }>;
  cancelamentosOutroMes: Array<{ arquivo: string; chave: string }>;
  eventosNaoAplicados: Array<{ arquivo: string; chave: string; tpEvento: string; cStat: string }>;
  inutilizacoes: Inutilizacao[];
  incompletos: Array<{ arquivo: string; motivo: string }>;
  divergentes: string[];
  foraDoPeriodo: Array<{ chave: string; competencia: string }>;
}

export interface LeituraPacote {
  notas: NotaRelatorio[];
  conferencia: Conferencia;
  arquivos: Record<string, Uint8Array>;
}

export interface TotalGrupo {
  grupo: string; quantidade: number;
  produtosC: number; freteC: number; descontoC: number; totalC: number;
}

export class ErroDownloadIncompleto extends Error {
  constructor() { super('O download veio incompleto — gere o pacote de novo.'); this.name = 'ErroDownloadIncompleto'; }
}

export const AVISOS_FIXOS = [
  'Conciliação com as vendas não incluída nesta versão.',
  'Notas emitidas fora do Mercado Livre e não enviadas a ele não aparecem aqui.',
] as const;

export const rotuloTipo = (t: TipoNota) =>
  ({ venda: 'Venda', complementar: 'Complementar', devolucao: 'Devolução' })[t];
export const rotuloStatus = (s: StatusNota) => (s === 'autorizada' ? 'Autorizada' : 'Cancelada');

const GRUPOS: Array<[TipoNota, StatusNota, string]> = [
  ['venda', 'autorizada', 'Vendas autorizadas'], ['venda', 'cancelada', 'Vendas canceladas'],
  ['complementar', 'autorizada', 'Complementares autorizadas'], ['complementar', 'cancelada', 'Complementares canceladas'],
  ['devolucao', 'autorizada', 'Devoluções autorizadas'], ['devolucao', 'cancelada', 'Devoluções canceladas'],
];

export function totaisPorGrupo(notas: NotaRelatorio[]): TotalGrupo[] {
  return GRUPOS.map(([tipo, status, grupo]) => {
    const g = notas.filter((n) => n.tipo === tipo && n.status === status);
    const soma = (k: 'produtosC' | 'freteC' | 'descontoC' | 'totalC') => g.reduce((a, n) => a + n[k], 0);
    return { grupo, quantidade: g.length, produtosC: soma('produtosC'), freteC: soma('freteC'), descontoC: soma('descontoC'), totalC: soma('totalC') };
  });
}
