import { zipSync, strToU8 } from 'fflate';
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
export const EMIT = '11222333000181';
/** 44 dígitos: 25 fixos + nNF (9) + 1 + cNF (8) + DV fictício (1). */
export const CHAVE = (n: number) => `2626091122233300018155001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}0`;

export function nfe(o: {
  n: number; dhEmi?: string; tpNF?: string; finNFe?: string; cfops?: string[]; cStat?: string;
  vProd?: string; vFrete?: string; vDesc?: string; vNF?: string; refNFe?: string; semCampo?: 'dhEmi' | 'vNF';
}): string {
  const ch = CHAVE(o.n);
  const dets = (o.cfops ?? ['5102']).map((c, i) => `<det nItem="${i + 1}"><prod><CFOP>${c}</CFOP></prod></det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc ${NS} versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00">`
    + `<ide><serie>1</serie><nNF>${o.n}</nNF>${o.semCampo === 'dhEmi' ? '' : `<dhEmi>${o.dhEmi ?? '2026-09-10T10:00:00-03:00'}</dhEmi>`}`
    + `<tpNF>${o.tpNF ?? '1'}</tpNF><finNFe>${o.finNFe ?? '1'}</finNFe>${o.refNFe ? `<NFref><refNFe>${o.refNFe}</refNFe></NFref>` : ''}</ide>`
    + `<emit><CNPJ>${EMIT}</CNPJ></emit>${dets}<total><ICMSTot><vProd>${o.vProd ?? '100.00'}</vProd><vFrete>${o.vFrete ?? '0.00'}</vFrete>`
    + `<vDesc>${o.vDesc ?? '0.00'}</vDesc>${o.semCampo === 'vNF' ? '' : `<vNF>${o.vNF ?? '100.00'}</vNF>`}</ICMSTot></total></infNFe></NFe>`
    + `<protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><cStat>${o.cStat ?? '100'}</cStat></infProt></protNFe></nfeProc>`;
}

export function evento(o: {
  n: number; tpEvento: '110111' | '110110'; cStat?: string; seq?: number; chaveRet?: string; semRet?: boolean;
  tpRet?: string; seqRet?: number; semCStat?: boolean;
}): string {
  const ch = CHAVE(o.n);
  const ret = o.semRet ? '' : `<retEvento versao="1.00"><infEvento><tpEvento>${o.tpRet ?? o.tpEvento}</tpEvento><nSeqEvento>${o.seqRet ?? o.seq ?? 1}</nSeqEvento>`
    + `${o.semCStat ? '' : `<cStat>${o.cStat ?? '135'}</cStat>`}<chNFe>${o.chaveRet ?? ch}</chNFe></infEvento></retEvento>`;
  return `<?xml version="1.0"?><procEventoNFe ${NS} versao="1.00"><evento versao="1.00"><infEvento>`
    + `<chNFe>${ch}</chNFe><tpEvento>${o.tpEvento}</tpEvento><nSeqEvento>${o.seq ?? 1}</nSeqEvento></infEvento></evento>${ret}</procEventoNFe>`;
}

export function inut(o: { ini: number; fim: number; cStat?: string; semRet?: boolean }): string {
  const ret = o.semRet ? '' : `<retInutNFe versao="4.00"><infInut><cStat>${o.cStat}</cStat><xMotivo>motivo ${o.cStat}</xMotivo></infInut></retInutNFe>`;
  return `<?xml version="1.0"?><procInutNFe ${NS} versao="4.00"><inutNFe versao="4.00"><infInut>`
    + `<serie>1</serie><nNFIni>${o.ini}</nNFIni><nNFFin>${o.fim}</nNFFin><xJust>Numero nao utilizado</xJust></infInut></inutNFe>${ret}</procInutNFe>`;
}

export const zip = (arquivos: Record<string, string>, level: 0 | 6 = 6) =>
  zipSync(Object.fromEntries(Object.entries(arquivos).map(([k, v]) => [k, strToU8(v)])), { level });
