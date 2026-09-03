import { describe, expect, it } from 'vitest';
import {
  statusUpdatePorProduto, familiaEmVoo, codigosConcluidosComSucesso, coresSemVinculoPorProduto,
  loteUpdatePorProduto, type FamiliaStatusRow,
} from '../estoque-update-status';

function row(over: Partial<FamiliaStatusRow> = {}): FamiliaStatusRow {
  return { codigo_pai: '00000100', status: 'pronto', operacao: 'UPDATE', criado_em: '2026-08-19T00:00:00Z', ...over };
}

describe('statusUpdatePorProduto', () => {
  it('UPDATE publicando -> atualizando', () => {
    const rows = [row({ status: 'publicando' })];
    expect(statusUpdatePorProduto(rows).get('00000100')).toBe('atualizando');
  });

  it('UPDATE erro de ontem -> erro', () => {
    const agora = new Date('2026-08-20T12:00:00Z');
    const rows = [row({ status: 'erro', criado_em: '2026-08-19T12:00:00Z' })];
    expect(statusUpdatePorProduto(rows, agora).get('00000100')).toBe('erro');
  });

  it('UPDATE erro de 8 dias atrás -> ausente', () => {
    const agora = new Date('2026-08-20T12:00:00Z');
    const rows = [row({ status: 'erro', criado_em: '2026-08-12T12:00:00Z' })];
    expect(statusUpdatePorProduto(rows, agora).has('00000100')).toBe(false);
  });

  it('CREATE pendente -> ausente (ignora operacao=CREATE)', () => {
    const rows = [row({ status: 'pendente', operacao: 'CREATE' })];
    expect(statusUpdatePorProduto(rows).has('00000100')).toBe(false);
  });

  it('duas famílias UPDATE do mesmo pai (erro antiga + publicando nova) -> a mais recente vence', () => {
    const agora = new Date('2026-08-20T12:00:00Z');
    const rows = [
      row({ status: 'erro', criado_em: '2026-08-15T00:00:00Z' }),
      row({ status: 'publicando', criado_em: '2026-08-19T00:00:00Z' }),
    ];
    expect(statusUpdatePorProduto(rows, agora).get('00000100')).toBe('atualizando');
  });

  it('processando/pronto também contam como atualizando', () => {
    expect(statusUpdatePorProduto([row({ status: 'processando' })]).get('00000100')).toBe('atualizando');
    expect(statusUpdatePorProduto([row({ status: 'pronto' })]).get('00000100')).toBe('atualizando');
  });
});

describe('familiaEmVoo', () => {
  it('CREATE pendente -> true (qualquer operacao conta, mesmo predicado da edge)', () => {
    const rows = [row({ status: 'pendente', operacao: 'CREATE' })];
    expect(familiaEmVoo(rows, '00000100')).toBe(true);
  });

  it('UPDATE erro -> false (erro é terminal p/ D-8)', () => {
    const rows = [row({ status: 'erro' })];
    expect(familiaEmVoo(rows, '00000100')).toBe(false);
  });

  it('nada para o código -> false', () => {
    expect(familiaEmVoo([], '00000100')).toBe(false);
  });

  it('publicado -> false (terminal)', () => {
    const rows = [row({ status: 'publicado' })];
    expect(familiaEmVoo(rows, '00000100')).toBe(false);
  });
});

// Achado 2026-08-21: o badge só sumia, sem confirmação — o operador não sabia se tinha dado certo.
describe('codigosConcluidosComSucesso', () => {
  it('atualizando -> ausente = concluiu com sucesso', () => {
    const anterior = new Map([['00000100', 'atualizando' as const]]);
    const atual = new Map<string, 'atualizando' | 'erro'>();
    expect(codigosConcluidosComSucesso(anterior, atual)).toEqual(['00000100']);
  });

  it('atualizando -> erro NÃO conta (já tem badge próprio, não é sucesso)', () => {
    const anterior = new Map([['00000100', 'atualizando' as const]]);
    const atual = new Map([['00000100', 'erro' as const]]);
    expect(codigosConcluidosComSucesso(anterior, atual)).toEqual([]);
  });

  it('atualizando -> atualizando (ainda em voo) não conta', () => {
    const anterior = new Map([['00000100', 'atualizando' as const]]);
    const atual = new Map([['00000100', 'atualizando' as const]]);
    expect(codigosConcluidosComSucesso(anterior, atual)).toEqual([]);
  });

  it('erro -> ausente não conta (erro nunca foi "atualizando" nesse snapshot)', () => {
    const anterior = new Map([['00000100', 'erro' as const]]);
    const atual = new Map<string, 'atualizando' | 'erro'>();
    expect(codigosConcluidosComSucesso(anterior, atual)).toEqual([]);
  });

  it('vários códigos, só os que saíram de atualizando entram no resultado', () => {
    const anterior = new Map([
      ['00000100', 'atualizando' as const],
      ['00000200', 'atualizando' as const],
      ['00000300', 'erro' as const],
    ]);
    const atual = new Map([['00000200', 'atualizando' as const]]);
    expect(codigosConcluidosComSucesso(anterior, atual)).toEqual(['00000100']);
  });
});

describe('coresSemVinculoPorProduto', () => {
  it('devolve só as cores sem ml_variation_id da família UPDATE mais recente', () => {
    const rows = [row({
      status: 'erro',
      variacoes: [
        { codigo: '26706151', ml_variation_id: null },
        { codigo: '26706071', ml_variation_id: '205149271041' },
      ],
    })];
    expect(coresSemVinculoPorProduto(rows).get('00000100')).toEqual(new Set(['26706151']));
  });

  it('refiltra no cliente: embed sem filtro do servidor não marca cor já publicada', () => {
    const rows = [row({ variacoes: [{ codigo: '26706071', ml_variation_id: '205149271041' }] })];
    expect(coresSemVinculoPorProduto(rows).has('00000100')).toBe(false);
  });

  it('família UPDATE mais antiga não sobrepõe a mais recente', () => {
    const rows = [
      row({ criado_em: '2026-08-01T00:00:00Z', variacoes: [{ codigo: 'ANTIGA', ml_variation_id: null }] }),
      row({ criado_em: '2026-09-03T00:00:00Z', variacoes: [{ codigo: 'NOVA', ml_variation_id: null }] }),
    ];
    expect(coresSemVinculoPorProduto(rows).get('00000100')).toEqual(new Set(['NOVA']));
  });
});

describe('loteUpdatePorProduto', () => {
  it('devolve o lote da família UPDATE mais recente', () => {
    const rows = [
      row({ criado_em: '2026-08-01T00:00:00Z', lote_id: 'lote-antigo' }),
      row({ criado_em: '2026-09-03T00:00:00Z', lote_id: 'lote-novo' }),
    ];
    expect(loteUpdatePorProduto(rows).get('00000100')).toBe('lote-novo');
  });

  it('CREATE não entra', () => {
    expect(loteUpdatePorProduto([row({ operacao: 'CREATE', lote_id: 'x' })]).size).toBe(0);
  });
});
