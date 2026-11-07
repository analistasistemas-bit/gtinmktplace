import { describe, expect, it } from 'vitest';
import { avaliarPassos, mudouAvaliacao, mudouPrecos, resumir, resumirPrecos } from '../avaliacao.ts';
import type { CorAvaliada, OfertaVigente, Passo, PrecoAvaliado, Semaforo } from '../tipos.ts';

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
  it('chave de cor repetida → true (conservador)', () => {
    const nulas = (custo: number) => resumir([
      cor('verde', { variation_id: null, sku: null, custo }),
      cor('verde', { variation_id: null, sku: null }),
    ]);
    expect(mudouAvaliacao(nulas(5), nulas(9))).toBe(true);
    const dup = resumir([cor('verde'), cor('verde')]);
    expect(mudouAvaliacao(dup, dup)).toBe(true);
    expect(mudouAvaliacao(resumir([cor('verde')]), dup)).toBe(true);
  });
  it('origem diferente → true', () => {
    expect(mudouAvaliacao(resumir([cor('verde')]), resumir([cor('verde', { origem: 'importado' })]))).toBe(true);
    expect(mudouAvaliacao(resumir([cor('verde')]), resumir([cor('verde', { origem: null })]))).toBe(true);
  });
});

const p = (tipo: PrecoAvaliado['tipo'], semaforo: Semaforo, extra: Partial<CorAvaliada> & { chave?: string } = {}): PrecoAvaliado => {
  const { chave = tipo, ...c } = extra;
  return { tipo, chave, preco: 90, avaliacao: resumir([cor(semaforo, c)]) };
};

describe('avaliarPassos', () => {
  const oferta = { chave: 'P1:o1' } as OfertaVigente;
  const avaliar = async (preco: number) => resumir([cor(preco < 80 ? 'vermelho' : 'verde')]);
  const faixas: Passo = {
    tipo: 'faixas', estado: 'pendente', anterior: [],
    alvo: [{ min_unidades: 2, preco: 85.5 }, { min_unidades: 5, preco: 76.5 }],
  };

  it('avalia o alvo de base, de cada faixa e de cada oferta; saída não tem preço', async () => {
    const r = await avaliarPassos([
      { tipo: 'saida', oferta, estado: 'pendente' },
      { tipo: 'oferta', oferta, anterior: 70, alvo: 75, estado: 'pendente' },
      faixas,
      { tipo: 'base', anterior: 100, alvo: 90, estado: 'pendente' },
    ], avaliar);
    expect(r.map(({ tipo, chave, preco, avaliacao }) => [tipo, chave, preco, avaliacao.pior])).toEqual([
      ['oferta', 'P1:o1', 75, 'vermelho'],
      ['faixa', '2', 85.5, 'verde'],
      ['faixa', '5', 76.5, 'vermelho'],
      ['base', 'base', 90, 'verde'],
    ]);
  });

  it('só faixas: não avalia o base, e a faixa em prejuízo exige confirmação', async () => {
    const r = await avaliarPassos([faixas], avaliar);
    expect(r.map((x) => x.tipo)).toEqual(['faixa', 'faixa']);
    expect(resumirPrecos(r).tem_vermelho).toBe(true);
  });
});

describe('resumirPrecos', () => {
  it('agrega por todos os preços, um não esconde o outro', () => {
    expect(resumirPrecos([p('base', 'verde'), p('faixa', 'vermelho')]).tem_vermelho).toBe(true);
    expect(resumirPrecos([p('base', 'verde'), p('oferta', 'indisponivel')]).tem_sem_dado).toBe(true);
    expect(resumirPrecos([p('base', 'amarelo'), p('faixa', 'vermelho'), p('oferta', 'indisponivel')])).toMatchObject({
      pior: 'vermelho', tem_vermelho: true, tem_sem_dado: true,
    });
    expect(resumirPrecos([p('base', 'verde'), p('faixa', 'amarelo')])).toMatchObject({ pior: 'amarelo', tem_vermelho: false, tem_sem_dado: false });
  });
  it('só o base: igual à avaliação dele', () => {
    const b = p('base', 'verde');
    expect(resumirPrecos([b])).toEqual(b.avaliacao);
  });
});

describe('mudouPrecos', () => {
  const lista = () => [p('base', 'verde'), p('faixa', 'verde', { chave: '2' })];
  it('igual, em qualquer ordem → false', () => {
    expect(mudouPrecos(lista(), lista())).toBe(false);
    expect(mudouPrecos(lista(), [...lista()].reverse())).toBe(false);
  });
  it('semáforo e líquido não entram', () => {
    expect(mudouPrecos([p('faixa', 'verde')], [p('faixa', 'vermelho', { liquido: -1 })])).toBe(false);
  });
  it('custo mudou em qualquer preço → true', () => {
    expect(mudouPrecos([p('faixa', 'verde', { custo: 10 })], [p('faixa', 'verde', { custo: 12 })])).toBe(true);
  });
  it('conjunto diferente → true', () => {
    expect(mudouPrecos(lista(), [p('base', 'verde')])).toBe(true);
    expect(mudouPrecos([p('base', 'verde')], lista())).toBe(true);
  });
  it('mesma chave em tipos diferentes não casa', () => {
    expect(mudouPrecos([p('faixa', 'verde', { chave: '2' })], [p('oferta', 'verde', { chave: '2' })])).toBe(true);
  });
  it('chave repetida → true (conservador)', () => {
    const dup = [p('faixa', 'verde', { chave: '2' }), p('faixa', 'verde', { chave: '2' })];
    expect(mudouPrecos(dup, dup)).toBe(true);
  });
});
