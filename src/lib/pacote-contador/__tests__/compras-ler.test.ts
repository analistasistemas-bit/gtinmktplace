import { describe, it, expect } from 'vitest';
import { lerCompra, montarCompras } from '../compras-ler';
import type { XmlCompra } from '../tipos-compras';
import { xmlCompra, row, ok, CH } from './fixtures-compras';

const M = '2026-10';
const mapa = (e: Array<[string, XmlCompra]>) => new Map(e);

describe('lerCompra', () => {
  it('CSOSN, CST (ICMS00/ICMS60), ausente, e CST de IPI não capturado', () => {
    const r = lerCompra(xmlCompra({ n: 1, itens: [
      {}, { icms: '<ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>' },
      { icms: '<ICMS><ICMS60><orig>0</orig><CST>60</CST></ICMS60></ICMS>' },
      { icms: '<ICMS><ICMS10><orig>2</orig></ICMS10></ICMS>', ipiCst: '53' },
    ] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([1, 2, 3, 4].map((i) => r.trib.get(i))).toEqual([
      { tipo: 'CSOSN', codigo: '102' }, { tipo: 'CST', codigo: '00' }, { tipo: 'CST', codigo: '60' }, { tipo: '', codigo: '' },
    ]);
    expect(r.finNFe).toBe('1');
  });
  it('formato ERP (<nItem> como elemento) casa pelo número do item', () => {
    const r = lerCompra(xmlCompra({ n: 1, erp: true, itens: [{}, { icms: '<ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS>' }] }));
    if (!r.ok) throw new Error(r.erro);
    expect([1, 2].map((i) => r.trib.get(i))).toEqual([{ tipo: 'CSOSN', codigo: '102' }, { tipo: 'CST', codigo: '00' }]);
  });
  it('XML ilegível devolve ok:false', () => {
    expect(lerCompra('<nfeProc><quebrado').ok).toBe(false);
  });
});

describe('montarCompras', () => {
  it('linhas em centavos, ordem emissão/número/item, totais por componente e diferença', () => {
    const a = xmlCompra({ n: 2, dhEmi: '2026-10-20T10:00:00-03:00', itens: [{ vProd: '62.19', vSeg: '1.50', vOutro: '0.25' }, { vProd: '37.81' }],
      tot: { vProd: '100.00', vFrete: '10.00', vSeg: '1.50', vOutro: '0.25', vFCPST: '2.00', vNF: '113.75' } });
    const b = xmlCompra({ n: 1, dhEmi: '2026-10-05T10:00:00-03:00', tot: { vNF: '101.00' } });
    const l = montarCompras(M, [row({ n: 2, divergencia_total_aceita: 1 }), row({ n: 1 })], mapa([['id-2', ok(a)], ['id-1', ok(b)]]));
    expect(l.linhas.map((x) => [x.numero, x.nItem])).toEqual([['1', 1], ['2', 1], ['2', 2]]);
    expect(l.linhas[1]).toMatchObject({ produtosC: 6219, seguroC: 150, outrasC: 25, tribTipo: 'CSOSN', tribCodigo: '102', chave: CH(2), cnpj: '11222333000181', qCom: 2, finalidade: '1' });
    const t2 = l.totaisNota.find((t) => t.chave === CH(2))!;
    expect(t2).toMatchObject({ vProdC: 10000, vFreteC: 1000, vSegC: 150, vOutroC: 25, vFCPSTC: 200, vNFC: 11375, diferencaC: 0, divergenciaAceitaC: 100 });
    expect(l.totaisNota.find((t) => t.chave === CH(1))!.diferencaC).toBe(100);
    expect(l.conferencia).toMatchObject({ selecionadas: 2, detalhadas: 2, itens: 3, totalMesC: 21475, parcial: false, comFalha: 0 });
    expect(l.arquivos[`compras/xmls/${CH(1)}.xml`]).toBeDefined();
  });
  it('vII e vIPIDevol entram na diferença', () => {
    const l = montarCompras(M, [row({ n: 1 })], mapa([['id-1', ok(xmlCompra({ n: 1, tot: { vII: '3.00', vIPIDevol: '2.00', vNF: '105.00' } }))]]));
    expect(l.totaisNota[0].diferencaC).toBe(0);
  });
  it('desfeita e cancelada: XML na pasta própria, fora da planilha e dos totais, com a mesma classificação', () => {
    const l = montarCompras(M, [
      row({ n: 1 }), row({ n: 2, status: 'desfeita', desfeita_em: '2026-10-15T12:00:00+00:00', assinada: false }),
      row({ n: 3, status: 'cancelada', desfeita_em: '2026-10-16T12:00:00+00:00' }),
      row({ n: 4, status: 'desfeita' }), row({ n: 5, status: 'cancelada' }),
    ], mapa([['id-1', ok(xmlCompra({ n: 1 }))], ['id-2', ok(xmlCompra({ n: 2 }))], ['id-3', ok(xmlCompra({ n: 3 }))],
      ['id-4', { tipo: 'sem_hash' }], ['id-5', { tipo: 'divergente' }]]));
    expect(l.linhas.map((x) => x.numero)).toEqual(['1']);
    expect(l.totaisNota).toHaveLength(1);
    expect(Object.keys(l.arquivos).sort()).toEqual([`compras/xmls-canceladas/${CH(3)}.xml`, `compras/xmls-desfeitas/${CH(2)}.xml`, `compras/xmls/${CH(1)}.xml`]);
    expect(l.conferencia.desfeitas.map((d) => [d.chave, d.comXml])).toEqual([[CH(2), true], [CH(4), false]]);
    expect(l.conferencia.desfeitas[0].em).toBe('2026-10-15T12:00:00+00:00');
    expect(l.conferencia.canceladas.map((d) => d.chave)).toEqual([CH(3), CH(5)]);
    expect(l.conferencia.semAssinatura).toEqual([CH(2)]);
    expect(l.conferencia.semHash).toEqual([CH(4)]);
    expect(l.conferencia.divergentes).toEqual([CH(5)]);
    expect(l.conferencia).toMatchObject({ comFalha: 2, parcial: true, totalMesC: 10000, totalSemDetalheC: 0 });
  });
  it('falhas de importadas marcam PARCIAL; ilegível íntegro vai no zip; total sem detalhe separado', () => {
    const l = montarCompras(M, [row({ n: 1, valor_total: 50 }), row({ n: 2, valor_total: 70 }), row({ n: 3 }), row({ n: 4 })], mapa([
      ['id-1', { tipo: 'indisponivel', motivo: 'tempo esgotado' }], ['id-2', { tipo: 'divergente' }],
      ['id-3', { tipo: 'sem_hash' }], ['id-4', ok('<nfeProc><quebrado')],
    ]));
    expect(l.conferencia).toMatchObject({ selecionadas: 4, detalhadas: 0, comFalha: 4, parcial: true, totalMesC: 0, totalSemDetalheC: (50 + 70 + 100 + 100) * 100 });
    expect(l.conferencia.indisponiveis).toEqual([{ chave: CH(1), motivo: 'tempo esgotado' }]);
    expect(l.conferencia.divergentes).toEqual([CH(2)]);
    expect(l.conferencia.semHash).toEqual([CH(3)]);
    expect(l.conferencia.ilegiveis[0].chave).toBe(CH(4));
    expect(l.conferencia.motivosParcial).toEqual(['4 compras com falha']);
    expect(Object.keys(l.arquivos)).toEqual([`compras/xmls/${CH(4)}.xml`]);
  });
  it('sem assinatura e finalidade atípica (2 e 4) sinalizadas; mês vazio', () => {
    const l = montarCompras(M, [row({ n: 1, assinada: false }), row({ n: 2 })],
      mapa([['id-1', ok(xmlCompra({ n: 1, finNFe: '4' }))], ['id-2', ok(xmlCompra({ n: 2, finNFe: '2' }))]]));
    expect(l.conferencia.semAssinatura).toEqual([CH(1)]);
    expect(l.conferencia.finalidadeAtipica).toEqual([{ chave: CH(1), finNFe: '4' }, { chave: CH(2), finNFe: '2' }]);
    expect(l.linhas.map((x) => x.finalidade)).toEqual(['4', '2']);
    expect(montarCompras(M, [], new Map()).conferencia).toMatchObject({ vazio: true, parcial: false, selecionadas: 0 });
  });
});
