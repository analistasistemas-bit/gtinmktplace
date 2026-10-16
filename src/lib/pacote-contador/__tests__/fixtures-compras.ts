import { strToU8 } from 'fflate';
import type { NotaCompraRow } from '../tipos-compras';
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
export const CH = (n: number) => `2626101122233300018155001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}0`;

type Item = { cfop?: string; icms?: string; ipiCst?: string; vProd?: string; vFrete?: string; vSeg?: string; vOutro?: string; qCom?: string };
/** `erp: true` usa o formato de exportação de ERP aceito pelo Plano 1: `<det><nItem>N</nItem>…` (sem atributo). */
export function xmlCompra(o: { n: number; dhEmi?: string; finNFe?: string; itens?: Item[]; tot?: Partial<Record<string, string>>; erp?: boolean }): string {
  const itens = o.itens ?? [{}];
  const det = itens.map((it, i) => `${o.erp ? `<det><nItem>${i + 1}</nItem>` : `<det nItem="${i + 1}">`}<prod><cProd>P${i + 1}</cProd><cEAN>SEM GTIN</cEAN><xProd>Item ${i + 1}</xProd>`
    + `<NCM>61159500</NCM><CFOP>${it.cfop ?? '5102'}</CFOP><uCom>PC</uCom><qCom>${it.qCom ?? '2.0000'}</qCom><vProd>${it.vProd ?? '100.00'}</vProd>`
    + `${it.vFrete ? `<vFrete>${it.vFrete}</vFrete>` : ''}${it.vSeg ? `<vSeg>${it.vSeg}</vSeg>` : ''}${it.vOutro ? `<vOutro>${it.vOutro}</vOutro>` : ''}</prod><imposto>`
    + `${it.icms ?? '<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>'}`
    + `${it.ipiCst ? `<IPI><IPINT><CST>${it.ipiCst}</CST></IPINT></IPI>` : ''}</imposto></det>`).join('');
  const t = { vProd: '100.00', vFrete: '0.00', vSeg: '0.00', vDesc: '0.00', vOutro: '0.00', vIPI: '0.00', vST: '0.00', vFCPST: '0.00', vNF: '100.00', ...o.tot };
  const tot = Object.entries(t).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc ${NS} versao="4.00"><NFe><infNFe Id="NFe${CH(o.n)}" versao="4.00">`
    + `<ide><mod>55</mod><serie>1</serie><nNF>${o.n}</nNF><dhEmi>${o.dhEmi ?? '2026-10-13T15:57:33-03:00'}</dhEmi><tpNF>1</tpNF><finNFe>${o.finNFe ?? '1'}</finNFe></ide>`
    + `<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR TESTE LTDA</xNome></emit><dest><CNPJ>11444777000161</CNPJ></dest>`
    + `${det}<total><ICMSTot>${tot}</ICMSTot></total></infNFe></NFe>`
    + `<protNFe versao="4.00"><infProt><chNFe>${CH(o.n)}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}

export function row(o: Partial<NotaCompraRow> & { n: number }): NotaCompraRow {
  return {
    id: `id-${o.n}`, chave: CH(o.n), numero: o.n, serie: 1, emitente_cnpj: '11222333000181', emitente_nome: 'FORNECEDOR TESTE LTDA',
    emitida_em: '2026-10-13T18:57:33+00:00', valor_total: 100, assinada: true, xml_path: `org/${CH(o.n)}/h.xml`, xml_sha256: 'a'.repeat(64),
    status: 'importada', importada_em: '2026-10-14T12:00:00+00:00', desfeita_em: null, divergencia_total_aceita: null, ...o,
  };
}
export const ok = (xml: string) => ({ tipo: 'ok' as const, bytes: strToU8(xml) });
