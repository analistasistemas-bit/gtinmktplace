// ADR-0181 Plano 2b-1 — modelo das compras do pacote do contador. Valores em centavos inteiros.
export interface NotaCompraRow {
  id: string; chave: string; numero: number; serie: number;
  emitente_cnpj: string; emitente_nome: string; emitida_em: string; valor_total: number;
  assinada: boolean; xml_path: string; xml_sha256: string | null;
  status: 'importada' | 'desfeita' | 'cancelada';
  importada_em: string; desfeita_em: string | null; divergencia_total_aceita: number | null;
}

export type XmlCompra =
  | { tipo: 'ok'; bytes: Uint8Array }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'sem_hash' }
  | { tipo: 'divergente' };

export interface LinhaCompra {
  instante: number; emissao: string; importacao: string; fornecedor: string; cnpj: string;
  numero: string; serie: string; chave: string; finalidade: string;
  nItem: number; cProd: string; xProd: string; ncm: string; cfop: string;
  tribTipo: 'CSOSN' | 'CST' | ''; tribCodigo: string;   // '' + '' = não informado
  qCom: number; uCom: string;
  produtosC: number; freteC: number; seguroC: number; descontoC: number; outrasC: number;
  ipiC: number; stC: number; fcpstC: number;
}

export interface TotalNotaCompra {
  instante: number; chave: string; numero: string; fornecedor: string;
  vProdC: number; vFreteC: number; vSegC: number; vDescC: number; vOutroC: number; vIPIC: number;
  vSTC: number; vFCPSTC: number; vNFC: number; diferencaC: number; divergenciaAceitaC: number | null;
}

export interface RegistroExcluida { chave: string; numero: number; fornecedor: string; em: string | null; comXml: boolean }

export interface ConferenciaCompras {
  mes: string; vazio: boolean; parcial: boolean; motivosParcial: string[];
  selecionadas: number; detalhadas: number; itens: number; comFalha: number;
  desfeitas: RegistroExcluida[]; canceladas: RegistroExcluida[];
  semAssinatura: string[];
  finalidadeAtipica: Array<{ chave: string; finNFe: string }>;
  indisponiveis: Array<{ chave: string; motivo: string }>;
  semHash: string[]; divergentes: string[];
  ilegiveis: Array<{ chave: string; erro: string }>;
  totalMesC: number; totalSemDetalheC: number;
}

export interface LeituraCompras {
  linhas: LinhaCompra[]; totaisNota: TotalNotaCompra[]; conferencia: ConferenciaCompras;
  arquivos: Record<string, Uint8Array>;   // caminho no zip → bytes
}

export const AVISOS_COMPRAS = [
  'Compras pela data de emissão; só notas importadas no PubliAI. Quantidade, unidade e CFOP são os do documento do fornecedor.',
  'O pacote reflete as notas e situações no momento da geração; se uma nota deste mês for importada depois, gere de novo e substitua o anterior.',
] as const;
