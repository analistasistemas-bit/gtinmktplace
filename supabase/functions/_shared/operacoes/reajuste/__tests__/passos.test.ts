import { describe, expect, it } from 'vitest';
import { oferta } from '../ofertas.ts';
import { estadosIntermediarios, planejarPassos, violacao, type EntradaPassos } from '../passos.ts';
import type { FaixaPreco, OfertaVigente, Passo } from '../tipos.ts';

const o = (chave: string, preco: number | null): OfertaVigente =>
  oferta({ promocao_id: chave, tipo: 'DEAL', status: 'started', preco, offer_id: chave, inicio: null, fim: null });
const f = (preco: number): FaixaPreco[] => [{ min_unidades: 2, preco }];
const e: EntradaPassos = { base: 100, alvo: 100, ofertas: [], ofertasNovas: {}, sair: [], faixasAntes: [], faixasAlvo: null };
const tipos = (p: Passo[]) => p.map((x) => x.tipo);

describe('planejarPassos', () => {
  it('ordem: descendo faixas antes do base, subindo depois, sem mudança só faixas', () => {
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 80, faixasAlvo: f(70) }))).toEqual(['faixas', 'base']);
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 120, faixasAlvo: f(110) }))).toEqual(['base', 'faixas']);
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 100, faixasAlvo: f(90) }))).toEqual(['faixas']);
  });

  it('ordem: oferta antes do base ao descer, depois ao subir', () => {
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 40, ofertas: [o('A', 50)], ofertasNovas: { A: 30 } }))).toEqual(['oferta', 'base']);
    expect(tipos(planejarPassos({ ...e, base: 40, alvo: 100, ofertas: [o('A', 30)], ofertasNovas: { A: 50 } }))).toEqual(['base', 'oferta']);
  });

  it('descendo com tudo: saídas, ofertas, faixas, base; subindo: base, ofertas, faixas', () => {
    const ofertas = [o('A', 50), o('B', 60)];
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 40, ofertas, sair: ['B'], ofertasNovas: { A: 30 }, faixasAlvo: f(20) })))
      .toEqual(['saida', 'oferta', 'faixas', 'base']);
    expect(tipos(planejarPassos({ ...e, base: 40, alvo: 100, ofertas: [o('A', 30)], ofertasNovas: { A: 50 }, faixasAlvo: f(90) })))
      .toEqual(['base', 'oferta', 'faixas']);
  });

  it('passos nascem pendentes e guardam anterior e alvo', () => {
    const p = planejarPassos({ ...e, base: 100, alvo: 40, ofertas: [o('A', 50)], ofertasNovas: { A: 30 }, faixasAntes: f(35), faixasAlvo: f(20) });
    expect(p).toEqual([
      { tipo: 'oferta', oferta: o('A', 50), anterior: 50, alvo: 30, estado: 'pendente' },
      { tipo: 'faixas', anterior: f(35), alvo: f(20), estado: 'pendente' },
      { tipo: 'base', anterior: 100, alvo: 40, estado: 'pendente' },
    ]);
  });

  it('lança se algum estado viola as invariantes', () => {
    expect(() => planejarPassos({ ...e, base: 100, alvo: 40, ofertas: [o('A', 50)] })).toThrow(/oferta/);
    expect(() => planejarPassos({ ...e, base: 100, alvo: 100, faixasAlvo: f(100) })).toThrow(/faixa/);
    expect(() => planejarPassos({ ...e, base: 100, alvo: 50, ofertas: [o('A', 50)] })).toThrow(/oferta/); // igual também não
    expect(() => planejarPassos({ ...e, base: 100, alvo: 80, faixasAntes: f(90) })).toThrow(/faixa/); // faixa velha ≥ novo base
    expect(() => planejarPassos({ ...e, base: 100, alvo: 80, faixasAlvo: f(85) })).toThrow(/faixa/);
    expect(() => planejarPassos({ ...e, base: 100, alvo: 120, faixasAlvo: f(120) })).toThrow(/faixa/);
    expect(() => planejarPassos({ ...e, base: 100, alvo: 120, ofertas: [o('A', 90)], ofertasNovas: { A: 130 } })).toThrow(/oferta/);
  });

  it('sem mudança de base só aceita faixas', () => {
    const ofertas = [o('A', 50)];
    expect(() => planejarPassos({ ...e, ofertas, ofertasNovas: { A: 30 } })).toThrow(/só faixas/);
    expect(() => planejarPassos({ ...e, ofertas, sair: ['A'] })).toThrow(/só faixas/);
    expect(() => planejarPassos({ ...e, base: 39.9, alvo: 39.9, ofertas, sair: ['A'], faixasAlvo: f(30) })).toThrow(/só faixas/);
  });

  it('oferta sem preço comprovado bloqueia, mesmo com novo valor; a saída a remove', () => {
    expect(() => planejarPassos({ ...e, base: 100, alvo: 120, ofertas: [o('A', null)] })).toThrow(/oferta/);
    expect(() => planejarPassos({ ...e, base: 100, alvo: 80, ofertas: [o('A', null)], ofertasNovas: { A: 70 } })).toThrow(/oferta/);
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 80, ofertas: [o('A', null)], sair: ['A'] }))).toEqual(['saida', 'base']);
  });

  it('compara em centavos', () => {
    expect(() => planejarPassos({ ...e, base: 100, alvo: 39.9, ofertas: [o('A', 39.9)] })).toThrow(/oferta/);
    expect(tipos(planejarPassos({ ...e, base: 100, alvo: 39.91, ofertas: [o('A', 39.9)] }))).toEqual(['base']);
    expect(planejarPassos({ ...e, base: 39.9, alvo: 39.9 })).toEqual([]);
  });
});

describe('estadosIntermediarios', () => {
  it('um estado depois de cada passo, sem mutar a entrada', () => {
    const ofertas = [o('A', 50), o('B', 60)];
    const passos = planejarPassos({ ...e, base: 100, alvo: 40, ofertas, sair: ['B'], ofertasNovas: { A: 30 }, faixasAntes: f(35), faixasAlvo: f(20) });
    const estados = estadosIntermediarios(100, ofertas, f(35), passos);
    expect(estados.map((s) => [s.base, s.ofertas.map((x) => x.preco), s.faixas[0].preco])).toEqual([
      [100, [50], 35], [100, [30], 35], [100, [30], 20], [40, [30], 20],
    ]);
    expect(ofertas.map((x) => x.preco)).toEqual([50, 60]);
  });
});

describe('violacao', () => {
  it('null com base acima das ofertas e faixas abaixo do base', () => {
    expect(violacao({ base: 100, ofertas: [o('A', 99.99)], faixas: f(99.99) })).toBeNull();
  });
  it('acusa oferta igual ou acima do base, oferta sem preço e faixa igual ou acima do base', () => {
    expect(violacao({ base: 100, ofertas: [o('A', 100)], faixas: [] })).toMatch(/oferta/);
    expect(violacao({ base: 100, ofertas: [o('A', null)], faixas: [] })).toMatch(/oferta/);
    expect(violacao({ base: 100, ofertas: [], faixas: f(100) })).toMatch(/faixa/);
  });
});
