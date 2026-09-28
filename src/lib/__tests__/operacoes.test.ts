import { describe, expect, it } from 'vitest';
import {
  inversa, itensRevertiveis, montarPreview, parsePreco, precisaConfirmarRisco, semaforoNoPreco,
} from '../operacoes';
import type { CorProjetada, ItemPromocao } from '../promocoes';
import { semaforoNoPreco as semaforoNoPrecoBackend } from '../../../supabase/functions/_shared/operacoes/validar';
import type { ProjecaoCor } from '../../../supabase/functions/_shared/promocoes/tipos';

function cor(over: Partial<CorProjetada> = {}): CorProjetada {
  return {
    variation_id: 1, cor: 'Azul', sku: null, custo: 5, piso: 10, origem: 'nacional',
    comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null,
    ...over,
  };
}
function item(over: Partial<ItemPromocao> = {}): ItemPromocao {
  return {
    ml_item_id: 'MLB1', status: 'candidate',
    preco_original: 100, preco_promo: 80, preco_min: 70, preco_max: 90,
    preco_sugerido: 85, preco_avaliado: 85, ml_pct: null, estoque_min: null,
    titulo: 'Produto', thumbnail: null, permalink: null,
    projecao: [cor()], pior_semaforo: 'verde',
    ...over,
  };
}

describe('parsePreco', () => {
  it.each([
    ['18,50', 18.5], ['18.5', 18.5], ['', null], ['abc', null],
  ])('%s → %s', (txt, esperado) => {
    expect(parsePreco(txt)).toBe(esperado);
  });
});

describe('montarPreview', () => {
  it('DEAL aderir marca só o verde e usa o sugerido', () => {
    const verde = item({ ml_item_id: 'V', preco_sugerido: 85, projecao: [cor({ custo: 5, piso: 10 })] });
    const vermelho = item({ ml_item_id: 'R', preco_sugerido: 5, projecao: [cor({ custo: 5, piso: 10 })] });
    const linhas = montarPreview('aderir', 'DEAL', [verde, vermelho]);
    expect(linhas.find((l) => l.ml_item_id === 'V')).toMatchObject({ preco: 85, semaforo: 'verde', marcado: true });
    expect(linhas.find((l) => l.ml_item_id === 'R')).toMatchObject({ preco: 5, marcado: false });
    expect(linhas.find((l) => l.ml_item_id === 'R')?.semaforo).not.toBe('verde');
  });

  it('SMART aderir usa o preço da oferta (preco_promo)', () => {
    const it1 = item({ preco_promo: 80, preco_sugerido: 999 });
    const [linha] = montarPreview('aderir', 'SMART', [it1]);
    expect(linha.preco).toBe(80);
  });

  it('sair usa o preço no ar e marca tudo, mesmo sem semáforo calculável', () => {
    const semDados = item({ preco_promo: null, projecao: [] });
    const linhas = montarPreview('sair', 'DEAL', [item({ preco_promo: 80 }), semDados]);
    expect(linhas.every((l) => l.marcado)).toBe(true);
    expect(linhas.find((l) => l.preco == null)?.semaforo).toBe('indisponivel');
  });
});

describe('precisaConfirmarRisco', () => {
  it('conta só as linhas marcadas', () => {
    const linhas = [
      { ml_item_id: '1', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'vermelho' as const, marcado: true },
      { ml_item_id: '2', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'vermelho' as const, marcado: false },
      { ml_item_id: '3', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'indisponivel' as const, marcado: true },
      { ml_item_id: '4', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'verde' as const, marcado: true },
    ];
    expect(precisaConfirmarRisco(linhas)).toEqual({ vermelho: 1, indisponivel: 1 });
  });
});

describe('itensRevertiveis', () => {
  const itens = [
    { ml_item_id: 'A', status: 'aplicado' as const },
    { ml_item_id: 'B', status: 'ja_estava' as const },
    { ml_item_id: 'C', status: 'erro' as const },
  ];
  it('sair só reverte aplicado', () => {
    expect(itensRevertiveis('sair', itens)).toEqual(['A']);
  });
  it('aderir reverte aplicado e ja_estava', () => {
    expect(itensRevertiveis('aderir', itens)).toEqual(['A', 'B']);
  });
});

describe('inversa', () => {
  it('troca a ação', () => {
    expect(inversa('aderir')).toBe('sair');
    expect(inversa('sair')).toBe('aderir');
  });
});

describe('paridade semáforo front × backend (operações)', () => {
  const casos: [ProjecaoCor[], number | null][] = [
    [[{ variation_id: 1, cor: null, sku: null, custo: 5, piso: 10, origem: 'nacional', comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null }], 85],
    [[{ variation_id: 1, cor: null, sku: null, custo: 5, piso: 10, origem: 'nacional', comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null }], 5],
    [[{ variation_id: 1, cor: null, sku: null, custo: null, piso: null, origem: null, comissao_pct: null, comissao_fixa: null, frete: null, aliquota_pct: null, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'indisponivel', motivo: 'sem_cadastro' }], 50],
  ];
  it.each(casos)('caso %#', (projecao, preco) => {
    expect(semaforoNoPreco(projecao as unknown as CorProjetada[], preco)).toBe(semaforoNoPrecoBackend(projecao, preco));
  });
});
