import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { lerPacote, lerPacoteVazio } from '../ler';
import { crc32 } from '../zip-integro';
import { ErroDownloadIncompleto, totaisPorGrupo } from '../tipos';
import { nfe, evento, inut, zip, CHAVE } from './fixtures';

const SET = '2026-09';
const AGORA = new Date('2026-10-16T12:00:00-03:00');
const ler = (a: Record<string, string>, mes = SET) => lerPacote(zip(a), mes, AGORA);

describe('zip íntegro', () => {
  it('crc32 conhecido', () => { expect(crc32(strToU8('123456789'))).toBe(0xcbf43926); });
  it('zip truncado é rejeitado inteiro', () => {
    const z = zip({ 'x/a.xml': nfe({ n: 1 }) });
    expect(() => lerPacote(z.slice(0, z.length - 30), SET, AGORA)).toThrow(ErroDownloadIncompleto);
  });
  it('byte alterado com mesmo tamanho (zip sem compressão) é rejeitado pelo CRC', () => {
    const z = zip({ 'x/a.xml': nfe({ n: 1, vNF: '100.00' }) }, 0);
    const alvo = strToU8('<vNF>100.00');
    const i = z.findIndex((_, k) => alvo.every((b, j) => z[k + j] === b));
    expect(i).toBeGreaterThan(0);
    const corrompido = z.slice(); corrompido[i + 5] = '9'.charCodeAt(0);
    expect(() => lerPacote(corrompido, SET, AGORA)).toThrow(ErroDownloadIncompleto);
  });
  it('EOCD adulterado (contagem +8, ou as duas contagens reduzidas) é rejeitado', () => {
    const z = zip({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': nfe({ n: 2 }) });
    let i = z.length - 22;
    while (i >= 0 && !(z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x05 && z[i + 3] === 0x06)) i--;
    const so8 = z.slice(); so8[i + 8] = 0; so8[i + 9] = 0;
    expect(() => lerPacote(so8, SET, AGORA)).toThrow(ErroDownloadIncompleto);
    const ambas = z.slice(); ambas[i + 8] = 1; ambas[i + 9] = 0; ambas[i + 10] = 1; ambas[i + 11] = 0;
    expect(() => lerPacote(ambas, SET, AGORA)).toThrow(ErroDownloadIncompleto);
  });
  it('dois formatos reais de pasta, sem documentos fiscais', () => {
    const l = ler({ 'Emitidas_Mercado_Livre/NF-e de venda/XML/Autorizadas/a.xml': nfe({ n: 1 }),
      'Emitidas_ERP/NF-e de venda/XML/Autorizadas/b.xml': nfe({ n: 2 }) });
    expect(l.notas).toHaveLength(2);
    expect(lerPacote(zip({}), SET, AGORA).conferencia).toMatchObject({ totalArquivos: 0, vazio: false });
  });
});

describe('lerPacote', () => {
  it('lê venda com namespace, valores em centavos e chave como texto', () => {
    const l = ler({ 'p/a.xml': nfe({ n: 1, vProd: '62.19', vFrete: '5.10', vDesc: '1.00', vNF: '66.29' }) });
    expect(l.notas[0]).toMatchObject({ chave: CHAVE(1), numero: '1', serie: '1', tipo: 'venda', status: 'autorizada',
      produtosC: 6219, freteC: 510, descontoC: 100, totalC: 6629, competencia: SET, cartaCorrecao: false });
    expect(CHAVE(1)).toHaveLength(44);
    expect(l.conferencia.parcial).toBe(false);
  });
  it('complementar (finNFe 2) e devolução de venda (tpNF 0, finNFe 4, CFOP 1202, refNFe)', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, finNFe: '2' }), 'x/b.xml': nfe({ n: 2, tpNF: '0', finNFe: '4', cfops: ['1202'], refNFe: CHAVE(9) }) });
    expect(l.notas.map((n) => n.tipo)).toEqual(['complementar', 'devolucao']);
    const ex = ler({ 'x/c.xml': nfe({ n: 3, tpNF: '0', finNFe: '4', cfops: ['3202'], refNFe: CHAVE(9) }) });
    expect(ex.notas[0].tipo).toBe('devolucao');
  });
  it('transferências, remessas e CFOP misto vão para "outros"', () => {
    const l = ler({
      'x/a.xml': nfe({ n: 1, cfops: ['5949'] }), 'x/b.xml': nfe({ n: 2, cfops: ['5102', '5949'] }),
      'x/c.xml': nfe({ n: 3, cfops: ['5151'] }), 'x/d.xml': nfe({ n: 4, cfops: ['5408'] }), 'x/e.xml': nfe({ n: 5, cfops: ['5410'] }),
      'x/f.xml': nfe({ n: 6, tpNF: '0', finNFe: '4', cfops: ['1208'], refNFe: CHAVE(9) }), 'x/g.xml': nfe({ n: 7, cfops: ['5102', '5152'] }),
    });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.outros).toHaveLength(7);
  });
  it('cancelamento homologado marca a nota; rejeitado e 136 (sem vínculo) não alteram', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': nfe({ n: 2 }), 'x/c.xml': nfe({ n: 3 }),
      'x/d.xml': evento({ n: 1, tpEvento: '110111', cStat: '135' }), 'x/e.xml': evento({ n: 2, tpEvento: '110111', cStat: '573' }),
      'x/f.xml': evento({ n: 3, tpEvento: '110111', cStat: '136' }) });
    expect(l.notas.map((n) => n.status)).toEqual(['cancelada', 'autorizada', 'autorizada']);
    expect(l.conferencia.eventosNaoAplicados.map((e) => e.cStat)).toEqual(['573', '136']);
  });
  it('evento sem retorno, sem cStat, ou com chave/tipo/sequência do retorno diferentes é incompleto (PARCIAL)', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': evento({ n: 1, tpEvento: '110111', semRet: true }),
      'x/c.xml': evento({ n: 1, tpEvento: '110111', chaveRet: CHAVE(8) }), 'x/d.xml': evento({ n: 1, tpEvento: '110111', semCStat: true }),
      'x/e.xml': evento({ n: 1, tpEvento: '110111', tpRet: '110110' }), 'x/f.xml': evento({ n: 1, tpEvento: '110111', seq: 1, seqRet: 2 }) });
    expect(l.notas[0].status).toBe('autorizada');
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/b.xml', 'x/c.xml', 'x/d.xml', 'x/e.xml', 'x/f.xml']);
    expect(l.conferencia.parcial).toBe(true);
  });
  it('cancelamento de nota que não está no zip vai para "cancelamento de nota de outro mês"', () => {
    const l = ler({ 'x/c.xml': evento({ n: 7, tpEvento: '110111' }) });
    expect(l.conferencia.cancelamentosOutroMes).toEqual([{ arquivo: 'x/c.xml', chave: CHAVE(7) }]);
  });
  it('CC-e só com 135; 155 em CC-e não vale', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1 }), 'x/b.xml': nfe({ n: 2 }),
      'x/c.xml': evento({ n: 1, tpEvento: '110110', seq: 2 }), 'x/d.xml': evento({ n: 2, tpEvento: '110110', cStat: '155' }) });
    expect(l.notas.map((n) => n.cartaCorrecao)).toEqual([true, false]);
  });
  it('inutilização homologada (102), rejeitada (203) e sem retorno (incompleta)', () => {
    const l = ler({ 'x/a.xml': inut({ ini: 1, fim: 1, cStat: '102' }), 'x/b.xml': inut({ ini: 2, fim: 2, cStat: '203' }),
      'x/c.xml': inut({ ini: 3, fim: 3, semRet: true }) });
    expect(l.conferencia.inutilizacoes.map((i) => [i.inicio, i.homologada, i.cStat])).toEqual([['1', true, '102'], ['2', false, '203']]);
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/c.xml']);
  });
  it('denegada (cStat 110) vai para denegadas', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, cStat: '110' }) });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.denegadas[0].cStat).toBe('110');
  });
  it('chave repetida igual conta uma vez; divergente marca PARCIAL mesmo se a 2ª for outra classificação', () => {
    const a = nfe({ n: 1 });
    expect(ler({ 'p1/a.xml': a, 'p2/a.xml': a }).notas).toHaveLength(1);
    for (const outra of [nfe({ n: 1, vNF: '999.00' }), nfe({ n: 1, cfops: ['5949'] }), nfe({ n: 1, cStat: '110' })]) {
      const d = ler({ 'p1/a.xml': a, 'p2/a.xml': outra });
      expect(d.conferencia.divergentes).toEqual([CHAVE(1)]);
      expect(d.conferencia.parcial).toBe(true);
    }
  });
  it('XML ilegível, campo ausente e valor inválido marcam PARCIAL', () => {
    const l = ler({ 'x/a.xml': '<nfeProc><quebrado', 'x/b.xml': nfe({ n: 2, semCampo: 'vNF' }),
      'x/c.xml': nfe({ n: 3, vNF: 'abc' }), 'x/d.xml': nfe({ n: 4, vProd: '1.234' }), 'x/e.xml': nfe({ n: 5, vNF: '99999999999999.00' }) });
    expect(l.notas).toHaveLength(0);
    expect(l.conferencia.incompletos.map((i) => i.arquivo)).toEqual(['x/a.xml', 'x/b.xml', 'x/c.xml', 'x/d.xml', 'x/e.xml']);
    expect(l.conferencia.parcial).toBe(true);
  });
  it('fuso: 30/09 23:30-03:00 é setembro; em pacote de outubro vai para "fora do período"', () => {
    const a = nfe({ n: 1, dhEmi: '2026-09-30T23:30:00-03:00' });
    expect(ler({ 'x/a.xml': a }).notas[0].competencia).toBe('2026-09');
    const out = ler({ 'x/a.xml': a }, '2026-10');
    expect(out.notas).toHaveLength(0);
    expect(out.conferencia.foraDoPeriodo).toEqual([{ chave: CHAVE(1), competencia: '2026-09' }]);
  });
  it('ordena por instante e desempata pela chave', () => {
    const l = ler({ 'x/c.xml': nfe({ n: 3, dhEmi: '2026-09-10T10:00:00-03:00' }),
      'x/a.xml': nfe({ n: 1, dhEmi: '2026-09-10T13:00:00Z' }), 'x/b.xml': nfe({ n: 2, dhEmi: '2026-09-02T08:00:00-03:00' }) });
    expect(l.notas.map((n) => n.numero)).toEqual(['2', '1', '3']);
  });
  it('mês em andamento e pacote vazio', () => {
    expect(lerPacote(zip({ 'x/a.xml': nfe({ n: 1, dhEmi: '2026-10-02T10:00:00-03:00' }) }), '2026-10', AGORA).conferencia.mesEmAndamento).toBe(true);
    const v = lerPacoteVazio(SET, AGORA);
    expect(v.notas).toEqual([]);
    expect(v.conferencia).toMatchObject({ vazio: true, parcial: false, totalArquivos: 0 });
  });
  it('totais por grupo: 6 grupos em ordem fixa', () => {
    const l = ler({ 'x/a.xml': nfe({ n: 1, vNF: '10.00' }), 'x/b.xml': nfe({ n: 2, vNF: '5.00' }), 'x/c.xml': evento({ n: 2, tpEvento: '110111' }) });
    const t = totaisPorGrupo(l.notas);
    expect(t.map((g) => g.grupo)).toEqual(['Vendas autorizadas', 'Vendas canceladas', 'Complementares autorizadas',
      'Complementares canceladas', 'Devoluções autorizadas', 'Devoluções canceladas']);
    expect(t[0]).toMatchObject({ quantidade: 1, totalC: 1000 });
    expect(t[1]).toMatchObject({ quantidade: 1, totalC: 500 });
  });
});
