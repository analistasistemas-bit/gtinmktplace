import { describe, it, expect } from 'vitest';
import { passosProgresso, margemSimulada, fichasAtivas, fichasSemVendedor, ETAPAS_SONAR } from '../sonar';
import type { PainelSonar } from '../sonar';

describe('passosProgresso — máquina dos 5 passos (ADR-0120; 5ª etapa = vendas, 18/08)', () => {
  it('início (0ms, sem resposta): 1º passo ativo, resto pendente', () => {
    expect(passosProgresso(0, false)).toEqual([
      { label: ETAPAS_SONAR[0], status: 'ativa' },
      { label: ETAPAS_SONAR[1], status: 'pendente' },
      { label: ETAPAS_SONAR[2], status: 'pendente' },
      { label: ETAPAS_SONAR[3], status: 'pendente' },
      { label: ETAPAS_SONAR[4], status: 'pendente' },
    ]);
  });

  it('avança um passo a cada 2,5s', () => {
    expect(passosProgresso(2500, false).map((p) => p.status)).toEqual(['concluida', 'ativa', 'pendente', 'pendente', 'pendente']);
    expect(passosProgresso(5000, false).map((p) => p.status)).toEqual(['concluida', 'concluida', 'ativa', 'pendente', 'pendente']);
  });

  it('trava na penúltima etapa enquanto a resposta não chega, por mais tempo que passe', () => {
    expect(passosProgresso(50_000, false).map((p) => p.status)).toEqual(['concluida', 'concluida', 'concluida', 'ativa', 'pendente']);
  });

  it('resposta chegando conclui todas as 5 etapas, mesmo com pouco tempo decorrido', () => {
    expect(passosProgresso(300, true).map((p) => p.status)).toEqual(['concluida', 'concluida', 'concluida', 'concluida', 'concluida']);
  });
});

describe('margemSimulada — recebe/imposto/margem sobre custo (não sobre preço, ver brief Task 4 #4)', () => {
  it('calcula recebe (preço − comissão − frete), imposto (alíquota × preço) e margem sobre o custo', () => {
    // recebe = 100 - 15 - 5 = 80; imposto = 8% de 100 = 8; líquido = 80 - 8 - 40 = 32; margem = 32/40 = 80%
    const r = margemSimulada({
      precoAlvo: 100, custo: 40, aliquotaPct: 8, tarifa: { comissao: 15, frete: 5 },
    });
    expect(r).toEqual({ recebe: 80, imposto: 8, liquido: 32, margemPct: 80 });
  });

  it('alíquota importado (16%) — imposto maior reduz a margem', () => {
    const r = margemSimulada({
      precoAlvo: 100, custo: 40, aliquotaPct: 16, tarifa: { comissao: 15, frete: 5 },
    });
    expect(r.imposto).toBe(16);
    expect(r.liquido).toBe(24);
    expect(r.margemPct).toBe(60);
  });

  it('custo zero não estoura (margem 0, não Infinity/NaN)', () => {
    const r = margemSimulada({ precoAlvo: 100, custo: 0, aliquotaPct: 8, tarifa: { comissao: 15, frete: 5 } });
    expect(r.margemPct).toBe(0);
  });
});

describe('fichasAtivas / fichasSemVendedor — separação por ofertas > 0 (ruling: ficha vazia não entra no painel principal)', () => {
  const ficha = (over: Partial<PainelSonar['fichas'][number]>): PainelSonar['fichas'][number] => ({
    product_id: 'MLB1', nome: 'Produto', category_id: 'MLB100', ofertas: 3,
    preco: { min: 10, mediana: 15, max: 20 }, frete_gratis_pct: 50, visitas_30d: 100,
    visitas_por_dia: [], vendedores: [{ seller_id: 1, uf: 'SP', transacoes_total: 10, loja_oficial: false }],
    ...over,
  });

  const painel = (fichas: PainelSonar['fichas']): PainelSonar => ({
    termo: 'x', gerado_em: '2026-08-17T00:00:00Z', total_catalogo: fichas.length, fichas,
    agregado: { visitas_30d_total: 0, visitas_por_dia: [], ofertas_total: 0, vendedores_distintos: 0, frete_gratis_pct: 0 },
    palavras_chave: [],
  });

  it('separa fichas com oferta ativa das vazias (ofertas: 0)', () => {
    const vazia = ficha({
      product_id: 'MLB2', ofertas: 0, category_id: null, preco: null, visitas_30d: null, vendedores: [],
    });
    const p = painel([ficha({}), vazia]);
    expect(fichasAtivas(p)).toEqual([ficha({})]);
    expect(fichasSemVendedor(p)).toEqual([vazia]);
  });

  it('painel sem fichas vazias: fichasSemVendedor vazio', () => {
    const p = painel([ficha({})]);
    expect(fichasSemVendedor(p)).toEqual([]);
  });
});
