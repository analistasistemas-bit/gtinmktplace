import { describe, expect, it } from 'vitest';
import { mudouAvaliacao, resumir } from '../avaliacao.ts';
import type { CorAvaliada, Semaforo } from '../tipos.ts';

const cor = (semaforo: Semaforo, extra: Partial<CorAvaliada> = {}): CorAvaliada => ({
  variation_id: '1', sku: 'A', custo: 5, piso: 7, origem: 'nacional', aliquota_pct: 8, comissao_pct: 11.5,
  comissao_fixa: 6.25, frete: 0, liquido: 3, semaforo, motivo: null, ...extra,
});

describe('resumir', () => {
  it('vazio → verde', () => expect(resumir([])).toEqual({ cores: [], pior: 'verde', tem_vermelho: false, tem_sem_dado: false }));
  it('pior por gravidade vermelho > indisponivel > amarelo > verde', () => {
    expect(resumir([cor('verde'), cor('amarelo')]).pior).toBe('amarelo');
    expect(resumir([cor('amarelo'), cor('indisponivel')]).pior).toBe('indisponivel');
    expect(resumir([cor('indisponivel'), cor('vermelho'), cor('verde')]).pior).toBe('vermelho');
  });
  it('flags', () => {
    const r = resumir([cor('vermelho'), cor('indisponivel')]);
    expect(r.tem_vermelho).toBe(true);
    expect(r.tem_sem_dado).toBe(true);
    const v = resumir([cor('verde')]);
    expect(v.tem_vermelho).toBe(false);
    expect(v.tem_sem_dado).toBe(false);
  });
});

describe('mudouAvaliacao', () => {
  const base = () => resumir([cor('verde'), cor('amarelo', { variation_id: '2', sku: 'B' })]);
  it('igual → false', () => expect(mudouAvaliacao(base(), base())).toBe(false));
  it('liquido/semaforo/motivo não entram', () => {
    const b = resumir([cor('vermelho', { liquido: -1, motivo: 'x' }), cor('amarelo', { variation_id: '2', sku: 'B' })]);
    expect(mudouAvaliacao(base(), b)).toBe(false);
  });
  it('ordem das cores não importa', () => {
    expect(mudouAvaliacao(base(), resumir([...base().cores].reverse()))).toBe(false);
  });
  it('chave cai no sku quando variation_id é null', () => {
    const a = resumir([cor('verde', { variation_id: null, sku: 'X' })]);
    const b = resumir([cor('verde', { variation_id: null, sku: 'Y' })]);
    expect(mudouAvaliacao(a, a)).toBe(false);
    expect(mudouAvaliacao(a, b)).toBe(true);
  });
  it('conjunto de cores diferente → true', () => {
    expect(mudouAvaliacao(base(), resumir([cor('verde')]))).toBe(true);
    expect(mudouAvaliacao(resumir([cor('verde')]), base())).toBe(true);
  });
  it('cada campo comparado em centavos (null ≠ número)', () => {
    for (const k of ['custo', 'piso', 'aliquota_pct', 'comissao_pct', 'comissao_fixa', 'frete'] as const) {
      const v = cor('verde')[k] as number;
      const um = resumir([cor('verde')]);
      const nulo = resumir([cor('verde', { [k]: null })]);
      expect(mudouAvaliacao(um, resumir([cor('verde', { [k]: v + 0.01 })])), k).toBe(true);
      expect(mudouAvaliacao(um, resumir([cor('verde', { [k]: v + 0.001 })])), k).toBe(false);
      expect(mudouAvaliacao(um, nulo), k).toBe(true);
      expect(mudouAvaliacao(nulo, um), k).toBe(true);
      expect(mudouAvaliacao(nulo, nulo), k).toBe(false);
    }
  });
  it('origem diferente → true', () => {
    expect(mudouAvaliacao(resumir([cor('verde')]), resumir([cor('verde', { origem: 'importado' })]))).toBe(true);
    expect(mudouAvaliacao(resumir([cor('verde')]), resumir([cor('verde', { origem: null })]))).toBe(true);
  });
});
