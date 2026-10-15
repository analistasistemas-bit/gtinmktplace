import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe } from '../ler-nfe';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');

describe('lerNfe — exportação de ERP', () => {
  const r = lerNfe(fx('nfe-exportacao-erp.xml'));
  it('lê cabeçalho, totais e marca não assinada', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota).toMatchObject({
      chave: '26261011222333000181550010000010511000030324', numero: 1051, serie: 1, modelo: 55, tipoNf: 1,
      emitenteCnpj: '11222333000181', emitenteNome: 'FORNECEDOR TESTE LTDA', destinatarioCnpj: '11444777000161',
      assinada: false, cStat: 100, emitidaEm: '2026-10-13T15:57:33-03:00',
      totais: { vProd: 700, vFrete: 0, vNF: 700 },
    });
  });
  it('nItem elemento, SEM GTIN → null, entidade &amp; decodificada', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens[0]).toEqual({
      nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
      gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0,
    });
    expect(r.nota.itens[1].xProd).toBe('Conjunto infantil & bebê - DIV - DIV');
  });
});

describe('lerNfe — XML da SEFAZ', () => {
  const r = lerNfe(fx('nfe-sefaz.xml'));
  it('nItem atributo, assinatura, GTIN válido, ST/IPI no imposto, frete só no total', () => {
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.assinada).toBe(true);
    expect(r.nota.emitenteNome).toBe('FORNECEDOR TESTE LTDA');
    expect(r.nota.itens[0]).toMatchObject({
      nItem: 1, gtin: '7891234567895', uCom: 'CX', qCom: 2, vProd: 240, vFrete: 0, vSeg: 1,
      vDesc: 4, vOutro: 2, vIPI: 6, vST: 3, orig: 2,
    });
    expect(r.nota.totais).toMatchObject({ vFrete: 12, vNF: 260 });
  });
});

describe('lerNfe — endurecimento (rodada 2 do Codex)', () => {
  const base = fx('nfe-exportacao-erp.xml');
  it('NF-e escondida em comentário não conta como documento', () => {
    expect(lerNfe(`<?xml version="1.0"?><outro><!-- ${base.replace('<?xml version="1.0" encoding="utf-8"?>', '')} --></outro>`).ok).toBe(false);
  });
  it('chNFe do protocolo diferente do Id da infNFe recusa', () => {
    expect(lerNfe(base.replace('<chNFe>26261011222333000181550010000010511000030324</chNFe>',
      '<chNFe>26261011222333000181550010000010511000099991</chNFe>')).ok).toBe(false);
  });
  it('protocolo presente sem cStat recusa (não é "sem protocolo")', () => {
    expect(lerNfe(base.replace('<cStat>100</cStat>', '')).ok).toBe(false);
    expect(lerNfe(base.replace(/<protNFe>[\s\S]*<\/protNFe>/, '<protNFe/>')).ok).toBe(false);
    expect(lerNfe(base.replace(/<protNFe>[\s\S]*<\/protNFe>/, '<protNFe></protNFe>')).ok).toBe(false);
  });
  it('NF-e escondida dentro de uma instrução de processamento não conta', () => {
    const corpo = base.replace('<?xml version="1.0" encoding="utf-8"?>', '');
    expect(lerNfe(`<?xml version="1.0"?><?xml-stylesheet ${corpo} ?><outro/>`).ok).toBe(false);
  });
  it('mais de uma infNFe recusa', () => {
    const dup = base.replace('</NFe>', '</NFe><NFe><infNFe Id="NFe1"></infNFe></NFe>');
    expect(lerNfe(dup).ok).toBe(false);
  });
  it('aceita prefixo de namespace com hífen/ponto (nfe-1:)', () => {
    const pref = base.replace(/<(\/?)([A-Za-z])/g, '<$1nfe-1:$2').replace('<nfe-1:?xml', '<?xml');
    const r = lerNfe(pref);
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens).toHaveLength(2);
  });
});

describe('lerNfe — recusas', () => {
  it('não é NF-e, sem itens, número inválido', () => {
    expect(lerNfe('<?xml version="1.0"?><cteProc/>')).toEqual({ ok: false, erro: expect.stringContaining('NF-e') });
    expect(lerNfe(fx('nfe-exportacao-erp.xml').replace(/<det>[\s\S]*<\/det>/, '')).ok).toBe(false);
    expect(lerNfe(fx('nfe-exportacao-erp.xml').replace('<qCom>35.0000</qCom>', '<qCom>abc</qCom>')).ok).toBe(false);
  });
});
