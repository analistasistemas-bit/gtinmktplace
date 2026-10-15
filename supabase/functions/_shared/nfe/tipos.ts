// ADR-0181 — tipos da nota de compra. Importado pelo front e pela edge (sem jsr:/npm:/Deno).
export interface ItemNotaLido {
  nItem: number; cProd: string; xProd: string; ncm: string | null; cfop: string;
  gtin: string | null; uCom: string; qCom: number;
  vProd: number; vFrete: number; vSeg: number; vDesc: number; vOutro: number; vIPI: number; vST: number;
  vFCPST: number; // FCP retido por ST: integra o custo como o ST (R5-I2)
  orig: number | null;
}
export type CampoAcessorio = 'vFrete' | 'vSeg' | 'vDesc' | 'vOutro' | 'vIPI' | 'vST' | 'vFCPST';
export interface TotaisNota {
  vProd: number; vFrete: number; vSeg: number; vDesc: number; vOutro: number; vIPI: number; vST: number;
  vII: number; vIPIDevol: number; vFCPST: number; vNF: number;
}
export interface NotaCompraLida {
  chave: string; numero: number; serie: number; modelo: number; tipoNf: number;
  emitidaEm: string; emitenteCnpj: string; emitenteNome: string; destinatarioCnpj: string;
  totais: TotaisNota; assinada: boolean; cStat: number | null; itens: ItemNotaLido[];
}
/** Item depois da conciliação: valores efetivos (documento + rateio) e o rateio aplicado. */
export interface ItemConciliado extends ItemNotaLido { rateio: Partial<Record<CampoAcessorio, number>> }
export interface LinhaDistribuicao { codigo: string; quantidade: number; custoPrecificacao: number }
/** O que o NAVEGADOR manda por item: só decisões do operador. */
export interface DecisaoImportacao { nItem: number; codigoPai: string; fator: number; distribuicao: LinhaDistribuicao[] }
