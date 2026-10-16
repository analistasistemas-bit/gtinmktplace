import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validarImportacao } from '../validar';

const XML = readFileSync(join(__dirname, '../../_shared/nfe/__tests__/fixtures/nfe-exportacao-erp.xml'), 'utf8');
const CNPJ = '11444777000161';
const dec = [
  { nItem: 1, codigoPai: 'P1', fator: 1, distribuicao: [{ codigo: 'S1', quantidade: 35, custoPrecificacao: 14 }] },
  { nItem: 2, codigoPai: 'P2', fator: 1, distribuicao: [{ codigo: 'S2', quantidade: 35, custoPrecificacao: 14 }] },
];

describe('validarImportacao', () => {
  it('aceita e deriva os dados do XML, não do navegador', () => {
    const r = validarImportacao({ xml: XML, decisoes: dec, nota: { destinatarioCnpj: CNPJ, itens: [] } }, CNPJ);
    if (!r.ok) throw new Error(r.erro);
    expect(r.nota.itens).toHaveLength(2);
    expect(r.itens[0].qCom).toBe(35);
  });
  it('corpo malformado não lança: devolve erro', () => {
    for (const b of [null, {}, { xml: 1 }, { xml: XML, decisoes: 'x' }, { xml: XML, decisoes: [{ nItem: 'a' }] }]) {
      expect(validarImportacao(b, CNPJ).ok).toBe(false);
    }
  });
  it('destinatário diferente da empresa recusa', () => {
    expect(validarImportacao({ xml: XML, decisoes: dec }, '99999999000191'))
      .toEqual({ ok: false, erro: expect.stringMatching(/destinat/i) });
  });
  it('chave com DV inválido, cStat ≠ 100, modelo ≠ 55, tipo ≠ saída recusam', () => {
    const casos = [
      XML.replaceAll('030324', '030325'),
      XML.replace('<cStat>100</cStat>', '<cStat>101</cStat>'),
      XML.replace('<mod>55</mod>', '<mod>65</mod>'),
      XML.replace('<tpNF>1</tpNF>', '<tpNF>0</tpNF>'),
    ];
    for (const x of casos) expect(validarImportacao({ xml: x, decisoes: dec }, CNPJ).ok).toBe(false);
  });
  it('CFOP fora da lista recusa nomeando o item', () => {
    expect(validarImportacao({ xml: XML.replace('<CFOP>5102</CFOP>', '<CFOP>5910</CFOP>'), decisoes: dec }, CNPJ))
      .toEqual({ ok: false, erro: expect.stringMatching(/item 1.*5910/i) });
  });
  it('totais incoerentes recusam', () => {
    expect(validarImportacao({ xml: XML.replace('<vProd>700.00</vProd>', '<vProd>650.00</vProd>'), decisoes: dec }, CNPJ).ok).toBe(false);
  });
  it('vNF divergente: recusa sem aceite, segue com aceite e devolve a diferença', () => {
    const x = XML.replace('<vNF>700.00</vNF>', '<vNF>705.00</vNF>');
    expect(validarImportacao({ xml: x, decisoes: dec }, CNPJ)).toEqual({ ok: false, erro: expect.stringMatching(/difere/) });
    const r = validarImportacao({ xml: x, decisoes: dec, aceitarDivergenciaTotal: true }, CNPJ);
    expect(r.ok && r.divergenciaTotal).toBe(5);
  });
  it('item sem decisão, decisão repetida ou de item inexistente recusam', () => {
    expect(validarImportacao({ xml: XML, decisoes: [dec[0]] }, CNPJ).ok).toBe(false);
    expect(validarImportacao({ xml: XML, decisoes: [dec[0], dec[0], dec[1]] }, CNPJ).ok).toBe(false);
    expect(validarImportacao({ xml: XML, decisoes: [...dec, { ...dec[0], nItem: 9 }] }, CNPJ).ok).toBe(false);
  });
  it('distribuição que não fecha com a quantidade convertida recusa', () => {
    const d = [{ ...dec[0], fator: 2 }, dec[1]];
    expect(validarImportacao({ xml: XML, decisoes: d }, CNPJ))
      .toEqual({ ok: false, erro: expect.stringMatching(/35 de 70/) });
  });
  it('XML acima de 1 MB recusa', () => {
    expect(validarImportacao({ xml: XML + ' '.repeat(1_048_577), decisoes: dec }, CNPJ).ok).toBe(false);
  });
});
