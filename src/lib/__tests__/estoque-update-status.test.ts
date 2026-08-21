import { describe, expect, it } from 'vitest';
import {
  statusUpdatePorProduto, familiaEmVoo, codigosConcluidosComSucesso, type FamiliaStatusRow,
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
