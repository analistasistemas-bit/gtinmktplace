import { describe, it, expect } from 'vitest';
import { avaliarConfirmacao, proximoPasso, ATRASOS_RELEITURA, type EnviadoSku } from '../avaliar';

const env = (qtd: number, anterior: number | null = null): EnviadoSku => ({ qtd, anterior, variacao_id: null });
const avaliar = (e: EnviadoSku, observado: number | null, mov?: number) => avaliarConfirmacao({
  enviado: { A: e },
  observado: { A: observado },
  movimentos: mov === undefined ? {} : { A: mov },
});

describe('avaliarConfirmacao (ADR-0195)', () => {
  it('observado igual ao enviado: ok', () => {
    expect(avaliar(env(10), 10)).toEqual({ ok: true, naoAplicada: false, explicavelPorMovimento: false, divergentes: [] });
  });

  it('venda entre o envio e a leitura: ok', () => {
    expect(avaliar(env(10), 8, -2).ok).toBe(true);
  });

  it('movimento ainda não refletido no ML: ok', () => {
    expect(avaliar(env(10), 10, -2).ok).toBe(true);
  });

  it('entrada no app com push em voo: ok', () => {
    expect(avaliar(env(10), 10, 5).ok).toBe(true);
  });

  it('diferença sem explicação: divergente', () => {
    const r = avaliar(env(10), 7, 0);
    expect(r.ok).toBe(false);
    expect(r.explicavelPorMovimento).toBe(false);
    expect(r.divergentes).toEqual([{ sku: 'A', enviado: 10, observado: 7 }]);
  });

  it('SKU sem leitura: divergente', () => {
    const r = avaliar(env(10), null);
    expect(r.ok).toBe(false);
    expect(r.divergentes).toEqual([{ sku: 'A', enviado: 10, observado: null }]);
  });

  it('SKU ausente do observado conta como sem leitura', () => {
    const r = avaliarConfirmacao({ enviado: { A: env(10) }, observado: {}, movimentos: {} });
    expect(r.divergentes).toEqual([{ sku: 'A', enviado: 10, observado: null }]);
  });

  it('teto: compara com o valor cortado, venda reduz os dois lados', () => {
    expect(avaliar(env(1164), 1163, -1).ok).toBe(true);
  });

  it('escrita ignorada é divergente mesmo com movimento que não a explica', () => {
    const r = avaliar(env(10, 15), 15, 3);
    expect(r.ok).toBe(false);
    expect(r.naoAplicada).toBe(true);
    expect(r.divergentes).toEqual([{ sku: 'A', enviado: 10, observado: 15 }]);
  });

  it('sem mudança pedida não é escrita ignorada', () => {
    const r = avaliar(env(10, 10), 10);
    expect(r.ok).toBe(true);
    expect(r.naoAplicada).toBe(false);
  });

  it('anterior null não ativa escrita ignorada', () => {
    expect(avaliar(env(10, null), 7, 0).naoAplicada).toBe(false);
    expect(avaliar(env(10, null), null).naoAplicada).toBe(false);
  });

  it('divergência com movimento na janela é explicável', () => {
    const r = avaliar(env(10), 7, -1);
    expect(r.ok).toBe(false);
    expect(r.explicavelPorMovimento).toBe(true);
  });

  it('movimento de SKU que bateu não torna explicável o divergente de outro', () => {
    const r = avaliarConfirmacao({
      enviado: { A: env(10), B: env(5) },
      observado: { A: 8, B: 1 },
      movimentos: { A: -2 },
    });
    expect(r.divergentes.map((d) => d.sku)).toEqual(['B']);
    expect(r.explicavelPorMovimento).toBe(false);
  });
});

describe('avaliarConfirmacao — venda no ML × escrita ignorada', () => {
  const e = (qtd: number, anterior: number) => ({ qtd, anterior, variacao_id: null });

  it('venda de 2 depois do PUT aplicado, voltando ao saldo anterior, não é escrita ignorada', () => {
    const r = avaliarConfirmacao({
      enviado: { A: e(10, 8) }, observado: { A: 8 }, movimentos: { A: -2 }, movimentosMl: { A: -2 },
    });
    expect(r.ok).toBe(true);
  });

  it('PUT ignorado e venda: ML em anterior + venda é escrita não aplicada', () => {
    const r = avaliarConfirmacao({
      enviado: { A: e(10, 8) }, observado: { A: 6 }, movimentos: { A: -2 }, movimentosMl: { A: -2 },
    });
    expect(r).toMatchObject({ ok: false, naoAplicada: true });
  });

  it('saldo igual ao anterior sem movimento é escrita não aplicada', () => {
    const r = avaliarConfirmacao({ enviado: { A: e(10, 15) }, observado: { A: 15 }, movimentos: {} });
    expect(r).toMatchObject({ ok: false, naoAplicada: true });
  });

  it('entrada do app torna ambíguo: nunca confirmado, e explicável em vez de falha', () => {
    const r = avaliarConfirmacao({ enviado: { A: e(10, 15) }, observado: { A: 15 }, movimentos: { A: 5 } });
    expect(r).toMatchObject({ ok: false, naoAplicada: false, explicavelPorMovimento: true });
  });
});

describe('proximoPasso (ADR-0195)', () => {
  const base = { ok: false, naoAplicada: false, explicavelPorMovimento: false, leituraFalhou: false };

  it('releituras crescentes', () => {
    expect(ATRASOS_RELEITURA).toEqual([180, 600]);
  });

  it('ok: confirmado', () => {
    expect(proximoPasso({ ...base, ok: true, tentativa: 1 })).toEqual({ status: 'confirmado' });
  });

  it('divergente relê nas tentativas 1 e 2 e falha na 3', () => {
    expect(proximoPasso({ ...base, tentativa: 1 })).toEqual({ reler: 180 });
    expect(proximoPasso({ ...base, tentativa: 2 })).toEqual({ reler: 600 });
    expect(proximoPasso({ ...base, tentativa: 3 })).toEqual({ status: 'falhou' });
  });

  it('divergência com movimento na 3 é inconclusiva', () => {
    expect(proximoPasso({ ...base, explicavelPorMovimento: true, tentativa: 3 })).toEqual({ status: 'inconclusivo' });
  });

  it('escrita não aplicada na 3 falha mesmo com movimento', () => {
    expect(proximoPasso({ ...base, naoAplicada: true, explicavelPorMovimento: true, tentativa: 3 })).toEqual({ status: 'falhou' });
  });

  it('leitura falhou: relê e, esgotada, inconclusivo', () => {
    expect(proximoPasso({ ...base, leituraFalhou: true, tentativa: 1 })).toEqual({ reler: 180 });
    expect(proximoPasso({ ...base, leituraFalhou: true, tentativa: 3 })).toEqual({ status: 'inconclusivo' });
  });
});
